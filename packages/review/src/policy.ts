/**
 * @prufs/review - policy.ts
 *
 * PolicyEngine: loads and evaluates OPA policies against a PolicyInput.
 *
 * Two adapters implement the PolicyEvaluator interface:
 *
 *   OpaWasmPolicy      - production. Loads a compiled OPA .wasm bundle
 *                        (produced offline by `opa build -t wasm`).
 *                        Evaluates via @open-policy-agent/opa-wasm.
 *
 *   FunctionPolicy     - test / dev. A plain JS function wrapped in the
 *                        PolicyEvaluator interface. No .wasm needed.
 *                        Used in all @prufs/review tests.
 *
 * Both return the same { allow: boolean; reasons: string[] } shape.
 * The PolicyEngine never cares which adapter is under the hood.
 *
 * Rego policy authoring guide (for teams writing real policies):
 * ---
 * package prufs.commit
 *
 * default allow := false
 *
 * allow if {
 *   some node in input.commit.trail.nodes
 *   node.type == "Decision"
 * }
 *
 * reasons contains msg if {
 *   not allow
 *   msg := "commit must contain at least one Decision node"
 * }
 * ---
 * Compile with: opa build -t wasm -e prufs/commit/allow policy.rego
 * Load with:    new OpaWasmPolicy('prufs.commit', fs.readFileSync('policy.wasm'))
 */

import * as fs from 'node:fs';
import type {
  PolicyEvaluator,
  PolicyInput,
  PolicyResult,
  PolicyDefinition,
  PolicyDecision,
} from './types.js';

// ---------------------------------------------------------------------------
// FunctionPolicy - JS function wrapped as a PolicyEvaluator (test / dev)
// ---------------------------------------------------------------------------

export type PolicyFn = (
  input: PolicyInput
) => Promise<{ allow: boolean; reasons: string[] }> | { allow: boolean; reasons: string[] };

export class FunctionPolicy implements PolicyEvaluator {
  private fn: PolicyFn;

  constructor(fn: PolicyFn) {
    this.fn = fn;
  }

  async evaluate(input: PolicyInput): Promise<{ allow: boolean; reasons: string[] }> {
    return this.fn(input);
  }
}

// ---------------------------------------------------------------------------
// OpaWasmPolicy - production OPA WASM evaluator
// ---------------------------------------------------------------------------

export class OpaWasmPolicy implements PolicyEvaluator {
  private wasmBytes: Buffer | Uint8Array;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private loadedPolicy: any | null = null;

  constructor(wasmBytes: Buffer | Uint8Array) {
    this.wasmBytes = wasmBytes;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loadedPolicy) return;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { loadPolicy } = require('@open-policy-agent/opa-wasm');
    this.loadedPolicy = await loadPolicy(this.wasmBytes);
  }

  async evaluate(input: PolicyInput): Promise<{ allow: boolean; reasons: string[] }> {
    await this.ensureLoaded();
    const results = this.loadedPolicy.evaluate({ input });

    // OPA evaluate() returns an array of result sets.
    // Standard shape: [{ result: { allow: bool, reasons: [...] } }]
    if (!results || results.length === 0) {
      return { allow: false, reasons: ['OPA policy returned no result'] };
    }

    const result = results[0]?.result ?? results[0];
    const allow = result?.allow === true;
    const reasons: string[] = Array.isArray(result?.reasons) ? result.reasons : [];

    return { allow, reasons };
  }
}

// ---------------------------------------------------------------------------
// PolicyEngine - evaluates all configured policies against a PolicyInput
// ---------------------------------------------------------------------------

export class PolicyEngine {
  private definitions: PolicyDefinition[];
  private resolvedEvaluators: Map<string, PolicyEvaluator> = new Map();

  constructor(definitions: PolicyDefinition[]) {
    this.definitions = definitions;
    this.preResolve();
  }

  /**
   * Pre-resolve all JS function evaluators. WASM evaluators are lazy-loaded
   * on first evaluate() call to avoid blocking the constructor.
   */
  private preResolve(): void {
    for (const def of this.definitions) {
      if (typeof def.evaluator !== 'string') {
        this.resolvedEvaluators.set(def.id, def.evaluator);
      }
    }
  }

  private async getEvaluator(def: PolicyDefinition): Promise<PolicyEvaluator> {
    const cached = this.resolvedEvaluators.get(def.id);
    if (cached) return cached;

    if (typeof def.evaluator === 'string') {
      // Load WASM from file path
      const wasmBytes = fs.readFileSync(def.evaluator);
      const evaluator = new OpaWasmPolicy(wasmBytes);
      this.resolvedEvaluators.set(def.id, evaluator);
      return evaluator;
    }

    return def.evaluator;
  }

  async evaluateAll(input: PolicyInput): Promise<PolicyResult[]> {
    if (this.definitions.length === 0) return [];

    const results: PolicyResult[] = [];

    for (const def of this.definitions) {
      try {
        const evaluator = await this.getEvaluator(def);
        const raw = await evaluator.evaluate(input);

        const decision: PolicyDecision = raw.allow ? 'allow' : 'deny';
        results.push({
          policy_id: def.id,
          decision,
          reasons: raw.reasons,
          raw_output: raw,
        });
      } catch (err) {
        results.push({
          policy_id: def.id,
          decision: 'unknown',
          reasons: [
            `Policy evaluation error: ${err instanceof Error ? err.message : String(err)}`,
          ],
        });
      }
    }

    return results;
  }
}

// ---------------------------------------------------------------------------
// Built-in policy factories (ready to use, no Rego compilation needed)
// ---------------------------------------------------------------------------

/**
 * requireDecisionNode
 * Every commit must contain at least one Decision node in its trail.
 * This is also enforced structurally by @prufs/commit, but enforcing it
 * here makes the policy layer independently auditable.
 */
export function requireDecisionNode(): FunctionPolicy {
  return new FunctionPolicy((input) => {
    const hasDecision = input.meta.has_decision_node;
    return {
      allow: hasDecision,
      reasons: hasDecision
        ? []
        : ['commit trail contains no Decision node - change is unjustified'],
    };
  });
}

/**
 * requireConstraintForRestrictedPaths
 * Any commit touching a restricted-sensitivity trail node must also
 * contain a Constraint node (e.g. citing a compliance framework or
 * internal policy document).
 */
export function requireConstraintForRestrictedPaths(): FunctionPolicy {
  return new FunctionPolicy((input) => {
    const hasRestricted = input.meta.restricted_node_count > 0;
    if (!hasRestricted) return { allow: true, reasons: [] };

    const hasConstraint = input.meta.has_constraint_node;
    return {
      allow: hasConstraint,
      reasons: hasConstraint
        ? []
        : [
            `commit contains ${input.meta.restricted_node_count} restricted trail node(s) ` +
            `but no Constraint node - a compliance reference is required`,
          ],
    };
  });
}

/**
 * requireVerificationForPaymentsPaths
 * Any commit touching paths under 'payments/' must have a Verification node.
 * Example of a domain-specific path-based policy.
 */
export function requireVerificationForPaymentsPaths(): FunctionPolicy {
  return new FunctionPolicy((input) => {
    const paymentsPaths = input.meta.restricted_paths.filter((p) =>
      p.startsWith('payments/')
    );
    if (paymentsPaths.length === 0) return { allow: true, reasons: [] };

    const hasVerification = input.meta.has_verification_node;
    return {
      allow: hasVerification,
      reasons: hasVerification
        ? []
        : [
            `commit touches payments paths (${paymentsPaths.join(', ')}) ` +
            `but contains no Verification node`,
          ],
    };
  });
}

/**
 * denyPublicAgentId
 * Rejects commits from agent IDs containing 'public' or 'anonymous'.
 * Demonstrates attestation-based policy gating.
 */
export function denyPublicAgentId(): FunctionPolicy {
  return new FunctionPolicy((input) => {
    const agentId = input.commit.attestation.agent_id.toLowerCase();
    const isPublic = agentId.includes('public') || agentId.includes('anonymous');
    return {
      allow: !isPublic,
      reasons: isPublic
        ? [`agent_id '${input.commit.attestation.agent_id}' is not permitted in this environment`]
        : [],
    };
  });
}
