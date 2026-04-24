#!/usr/bin/env python3
"""
agentforce_seed.py — Seed ClawdBots memory with Wade's Agentforce use cases
and their connections to the CRI framework dissertation research.
Run from ~/clawdbots:  python agentforce_seed.py
"""

from memory import remember, set_preference

print("═" * 60)
print("  ClawdBots Agentforce Use Case Seeder")
print("  4 banking use cases + CRI connections")
print("═" * 60)
print()

# ── Agentforce Use Cases ────────────────────────────────────────────────

use_cases = [
    # UC1: Sales Rep Onboarding
    """AGENTFORCE USE CASE 1 — New Sales Rep Onboarding Agent:
Purpose: Tracks education milestones, certification progress, and ramp-up activities
for newly hired sales representatives in banking/financial services.

How it works:
- Monitors rep's completion of compliance training, product knowledge modules, and
  system certifications
- Tracks milestones against expected onboarding timeline
- Alerts managers when reps fall behind or excel ahead of schedule
- Provides personalized next-step recommendations based on progress

CRI Framework Relevance:
- CORRECTNESS: Agent must accurately track and report milestone completion status;
  errors could lead to reps handling products they aren't certified for
- FAITHFULNESS: Progress reports must faithfully reflect actual completion data from
  LMS and CRM systems, not hallucinate milestone completions
- STABILITY: Onboarding timelines run weeks/months; agent must give consistent
  guidance across extended interactions
- CONSTRAINT COMPLIANCE: Must enforce regulatory training requirements (e.g., FINRA
  licensing prerequisites, anti-money-laundering training) — cannot mark compliance
  training as optional or skip required steps""",

    # UC2: Real-Time Sales Coaching
    """AGENTFORCE USE CASE 2 — Real-Time Sales Rep Coach:
Purpose: Listens to live sales calls and provides real-time suggestions for
overcoming objections and competitive positioning in banking/financial services.

How it works:
- Monitors live telephone conversations between sales reps and prospects
- Detects customer objections, competitor mentions, and buying signals in real-time
- Provides contextual coaching prompts (e.g., when customer mentions Microsoft 365,
  surface relevant competitive differentiators and talking points)
- Suggests relevant case studies, pricing comparisons, and feature advantages
- Logs coaching moments for post-call review and rep development tracking

CRI Framework Relevance:
- CORRECTNESS: Competitive intelligence and product claims must be factually accurate;
  incorrect claims during live calls create legal and reputational risk
- FAITHFULNESS: Coaching suggestions must be grounded in actual product capabilities
  and approved marketing materials, not hallucinated features or pricing
- STABILITY: Must provide consistent coaching quality across different call scenarios,
  customer types, and objection patterns — can't give contradictory advice
- CONSTRAINT COMPLIANCE: CRITICAL — must never suggest claims that violate financial
  regulations, fair lending laws, or approved marketing guidelines; real-time nature
  means there's no human review before rep potentially uses the suggestion""",

    # UC3: Customer Service with Full Context
    """AGENTFORCE USE CASE 3 — Contextual Customer Service Agent:
Purpose: Provides customer service agents with full customer context from Salesforce
CRM (Case, Account, Contact objects) combined with RAG-powered knowledge suggestions.

How it works:
- Pulls complete customer profile from Account and Contact objects (history,
  products held, previous interactions, relationship tier, lifetime value)
- Surfaces active Case details including full interaction history
- Uses RAG to retrieve relevant knowledge articles, policy documents, and
  resolution procedures based on the current issue
- Suggests resolution paths ranked by likelihood of customer satisfaction
- Maintains conversation context across transfers between agents/departments

CRI Framework Relevance:
- CORRECTNESS: Must accurately retrieve and present customer data; showing wrong
  account balances, product holdings, or case history erodes trust and causes errors
- FAITHFULNESS: RAG suggestions must faithfully represent source policy documents;
  hallucinating a policy or procedure in financial services has compliance implications
- STABILITY: Must give consistent resolution recommendations for similar cases;
  customers comparing notes should get aligned guidance
- CONSTRAINT COMPLIANCE: Must respect data access controls (agent can only see data
  their role permits), PII handling rules, and financial services disclosure
  requirements; RAG must only surface approved knowledge base content""",

    # UC4: Lead Nurturing / MQL
    """AGENTFORCE USE CASE 4 — Intelligent Lead Nurturing Agent:
Purpose: Ensures that by the time a sales rep first speaks with a prospect, they are
already a Marketing Qualified Lead (MQL) with rich context from brand interactions.

How it works:
- Tracks prospect interactions with marketing content (emails opened, pages visited,
  webinars attended, content downloaded, forms submitted)
- Combines explicitly provided information with deduced/inferred attributes
  (company size, likely needs, buying stage, budget indicators)
- Scores leads against MQL criteria and routes to sales when thresholds are met
- Provides sales reps with a comprehensive prospect brief before first contact,
  including engagement history, inferred needs, and suggested conversation starters
- Continuously updates prospect profiles as new interactions occur

CRI Framework Relevance:
- CORRECTNESS: Lead scoring and MQL determination must be accurate; routing unqualified
  leads wastes rep time, while missing qualified leads loses revenue
- FAITHFULNESS: Prospect briefs must faithfully reflect actual interactions and data,
  not infer interests that aren't supported by evidence; rep trust in the system
  depends on brief accuracy
- STABILITY: Scoring criteria must be consistently applied across all leads; similar
  engagement patterns should produce similar scores regardless of timing
- CONSTRAINT COMPLIANCE: Must comply with data privacy regulations (GDPR, CCPA),
  marketing consent preferences, and do-not-contact lists; inferred attributes must
  be clearly labeled as inferred vs. confirmed to avoid compliance issues""",
]

# ── Cross-cutting Agentforce-CRI Analysis ───────────────────────────────

analysis = [
    """AGENTFORCE-CRI CROSS-CUTTING ANALYSIS — Token Selection Impact:
Across all four Agentforce banking use cases, token-selection policy affects reliability:

1. Real-time coaching (UC2) is most sensitive — low-latency requirements favor greedy
   or low-temperature sampling, but this risks repetitive/generic suggestions. Nucleus
   sampling with moderate temperature may better balance speed and creativity.

2. Customer service RAG (UC3) benefits from constrained decoding that stays faithful
   to retrieved documents. Contrastive decoding (DoLa) could reduce hallucination of
   policy details. Temperature should be low for factual responses.

3. Lead scoring (UC4) involves structured output (scores, categories) where greedy
   decoding or very low temperature ensures deterministic, stable scoring.

4. Onboarding tracking (UC1) is least sensitive to token selection since outputs are
   mostly structured status reports, but natural language summaries still benefit from
   calibrated sampling.

This gradient from structured→creative across use cases provides natural experimental
conditions for testing CRI dimension sensitivity to token-selection policy.""",

    """AGENTFORCE-CRI CROSS-CUTTING ANALYSIS — Constraint Compliance in Banking:
All four use cases operate under financial services regulatory constraints:

- FINRA/SEC requirements (onboarding certifications, approved communications)
- Fair lending and advertising laws (coaching suggestions, lead nurturing content)
- Data privacy (GDPR, CCPA, GLBA for financial data)
- PII handling and data access controls (customer service context)
- Audit trail requirements (all agent actions must be logged and reviewable)

CRI Constraint Compliance must evaluate not just whether the agent follows rules,
but whether it maintains compliance under adversarial conditions (prompt injection,
edge cases, unusual customer requests). The MAST failure taxonomy (Cemri et al., 2025)
provides a framework for categorizing compliance failures across these use cases.""",

    """AGENTFORCE-CRI EXPERIMENTAL DESIGN — Dissertation Validation:
Wade's dissertation can use these four Agentforce use cases as a real-world validation
layer for the CRI framework, complementing academic benchmarks:

Academic benchmarks (controlled):
- AgentBench: multi-environment agent evaluation
- SWE-bench: real-world coding tasks
- TruthfulQA: factuality measurement

Enterprise validation (real-world):
- UC1 (Onboarding): CRI Stability over long time horizons
- UC2 (Coaching): CRI Correctness under real-time latency constraints
- UC3 (Customer Service): CRI Faithfulness in RAG-augmented contexts
- UC4 (Lead Nurturing): CRI Constraint Compliance with privacy regulations

Each use case naturally emphasizes different CRI dimensions, creating a 4×4 matrix
(4 use cases × 4 CRI dimensions) where each cell has varying priority. This provides
a structured experimental design for validating that CRI captures real-world reliability
concerns that academic benchmarks alone miss.""",
]

# ── Seed everything ─────────────────────────────────────────────────────

print("Seeding 4 Agentforce use cases...")
for i, uc in enumerate(use_cases, 1):
    remember(uc, domain="research")
    remember(uc, domain="general")  # Also accessible to general agents
    print(f"  ✓ Use Case {i} seeded (research + general)")

print("\nSeeding cross-cutting analysis...")
for i, a in enumerate(analysis, 1):
    remember(a, domain="research")
    print(f"  ✓ Analysis {i} seeded")

# ── Preferences ─────────────────────────────────────────────────────────
prefs = {
    "agentforce_use_cases": "4: onboarding, real-time coaching, customer service RAG, lead nurturing MQL",
    "agentforce_domain": "Banking and financial services",
    "agentforce_platform": "Salesforce Agentforce",
    "agentforce_crm_objects": "Case, Account, Contact, Lead, Opportunity",
    "agentforce_compliance_reqs": "FINRA, SEC, GDPR, CCPA, GLBA, fair lending, audit trails",
    "agentforce_cri_mapping": "UC1→Stability, UC2→Correctness, UC3→Faithfulness, UC4→Constraint Compliance",
}

print("\nSetting Agentforce preferences...")
for key, val in prefs.items():
    set_preference(key, val)
    print(f"  ✓ {key}")

print()
print("═" * 60)
print("  ✅ Seeded 4 use cases + 3 cross-cutting analyses")
print("     + 6 Agentforce preferences")
print("═" * 60)
