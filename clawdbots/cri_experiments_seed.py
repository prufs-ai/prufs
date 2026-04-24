#!/usr/bin/env python3
"""
cri_experiments_seed.py — Seed ClawdBots memory with CRI fine-tuning experiment
design, base model comparisons, and evaluation methodology.
Run from ~/clawdbots:  python3 cri_experiments_seed.py
"""

from memory import remember, set_preference

print("═" * 60)
print("  ClawdBots CRI Experiment Design Seeder")
print("═" * 60)
print()

# ── Experiment Overview ─────────────────────────────────────────────────

experiments = [
    """CRI EXPERIMENT DESIGN — Overview:
Research question: Does fine-tuning smaller LLMs with CRI-oriented training data
improve agent reliability (as measured by the four CRI dimensions) compared to
base models, and how do token-selection policies interact with fine-tuning?

Design: 3 base models × 2 conditions (base vs. CRI-tuned) × 5 decoding strategies
= 30 experimental configurations, each evaluated across 4 CRI dimensions and
multiple benchmarks.

Base models:
1. Mistral 7B (v0.3) — strong baseline, well-benchmarked, MoE-aware architecture
2. LLaMA 3.1 8B — Meta's latest open weights, extensive community evaluation
3. Kimi K2 — newer model, less studied, interesting comparison point

Fine-tuning method: QLoRA (4-bit quantization + LoRA adapters)
- Fits on single A100/H100 GPU
- ~2-4 hours per model fine-tune run
- Estimated cloud cost: ~$10-15 per full fine-tune

Decoding strategies to test:
1. Greedy (temperature=0)
2. Top-p nucleus sampling (p=0.9, temp=0.7)
3. Top-k sampling (k=50, temp=0.7)
4. DoLa contrastive decoding (Chuang et al., 2024)
5. Mirostat v2 (perplexity-controlled)""",

    # ── CRI Training Data Construction ──
    """CRI EXPERIMENT — Training Data Construction:
Four dataset components, one per CRI dimension:

1. CORRECTNESS PAIRS (~2,000 examples):
   Source: Adapt TruthfulQA + FActScore examples
   Format: (prompt, correct_completion, incorrect_completion)
   Banking overlay: Financial product descriptions, rate calculations,
   regulatory citations where accuracy is verifiable
   Label: preference pair for DPO/RLHF-style training

2. FAITHFULNESS PAIRS (~2,000 examples):
   Source: Adapt RAG evaluation datasets (RAGAS, RGB benchmark)
   Format: (context_document, question, faithful_answer, unfaithful_answer)
   Banking overlay: Policy documents, compliance guides, product sheets —
   answers must be grounded in the retrieved context, not hallucinated
   Label: faithful vs. unfaithful given source material

3. STABILITY PAIRS (~1,500 examples):
   Source: Generate paraphrased query sets
   Format: (query_v1, query_v2_paraphrase, expected_consistent_answer)
   Banking overlay: Same customer question asked different ways should
   get the same substantive answer about rates, policies, eligibility
   Label: consistency score across paraphrase sets

4. CONSTRAINT COMPLIANCE PAIRS (~1,500 examples):
   Source: Construct from banking regulation summaries
   Format: (user_request, policy_constraint, compliant_response, non_compliant_response)
   Banking overlay: Fair lending rules, disclosure requirements, PII handling,
   do-not-contact lists, FINRA/SEC boundaries
   Label: compliant vs. non-compliant given stated constraints

Total: ~7,000 training examples
Estimated construction time: 2-3 weeks with synthetic generation + human review""",

    # ── Evaluation Methodology ──
    """CRI EXPERIMENT — Evaluation Methodology:
Each of the 30 configurations (3 models × 2 conditions × 5 decodings) evaluated on:

ACADEMIC BENCHMARKS:
- TruthfulQA (Correctness): % truthful + informative responses
- FActScore (Faithfulness): atomic fact precision on biographical generation
- AgentBench (Multi-dimensional): 8-environment agent task completion
- SWE-bench Lite (Correctness): real GitHub issue resolution rate
- HaluEval (Faithfulness): hallucination detection across 3 tasks

CUSTOM CRI BENCHMARKS:
- CRI-Banking-Correct: 200 banking fact questions with verified answers
- CRI-Banking-Faithful: 200 RAG scenarios with policy documents + questions
- CRI-Banking-Stable: 100 question sets × 3 paraphrases each
- CRI-Banking-Compliant: 200 scenarios with explicit regulatory constraints

AGENTFORCE SCENARIOS (qualitative + quantitative):
- UC1 Onboarding: milestone tracking accuracy over simulated 30-day periods
- UC2 Coaching: real-time suggestion relevance + compliance (rated by domain expert)
- UC3 Customer Service: RAG faithfulness on real Salesforce knowledge base content
- UC4 Lead Nurturing: scoring consistency + privacy constraint adherence

STATISTICAL ANALYSIS:
- Paired t-tests: base vs. CRI-tuned for each model on each CRI dimension
- ANOVA: interaction effects between model × fine-tuning × decoding strategy
- Effect sizes (Cohen's d) for practical significance
- Confidence intervals on all CRI dimension scores""",

    # ── Autoresearch Integration ──
    """CRI EXPERIMENT — Autoresearch Fork Integration:
Wade's fork at github.com/WadeLovell/autoresearch adapts Karpathy's framework:

ORIGINAL autoresearch design:
- train.py: GPT model + optimizer + training loop (agent-modified)
- prepare.py: data loading + evaluation (fixed)
- program.md: agent instructions (human-edited)
- Metric: val_bpb (validation bits per byte)
- Budget: 5 minutes per experiment on H100

WADE'S CRI ADAPTATIONS needed:
1. Fork train.py → cri_train.py: Add CRI evaluation hooks that measure
   correctness, faithfulness, stability, and constraint compliance after
   each training run (not just val_bpb)

2. Fork prepare.py → cri_prepare.py: Load CRI training datasets alongside
   standard pretraining data; handle preference pair format for DPO

3. Update program.md → cri_program.md: Instruct agent to optimize for
   CRI dimensions, not just perplexity; define what "better" means across
   multiple objectives

4. Add cri_eval.py: Standalone evaluation script that runs all CRI
   benchmarks (academic + custom + Agentforce scenarios) on a checkpoint

5. Add experiment_tracker.py: Log all runs to SQLite with model, decoding
   config, CRI scores, and training hyperparameters for analysis

Cloud setup: Lambda Labs H100 instance, ~$2.50/hr
- Fine-tune run: ~2-4 hours ($5-10)
- Evaluation suite: ~1 hour ($2.50)
- Full 30-configuration experiment: ~$200-300 total""",

    # ── Timeline ──
    """CRI EXPERIMENT — Proposed Timeline:
Phase 1 — Data Construction (Weeks 1-3):
- Week 1: Generate Correctness + Faithfulness pairs (synthetic + review)
- Week 2: Generate Stability + Constraint Compliance pairs
- Week 3: Quality review, deduplication, train/val/test splits

Phase 2 — Infrastructure (Weeks 2-4, overlapping):
- Week 2: Fork autoresearch files, add CRI evaluation hooks
- Week 3: Set up cloud GPU workflow (Lambda Labs account, SSH config)
- Week 4: Validate pipeline end-to-end with small-scale test run

Phase 3 — Fine-tuning (Weeks 4-6):
- Week 4: Fine-tune Mistral 7B with CRI data (QLoRA)
- Week 5: Fine-tune LLaMA 3.1 8B with CRI data
- Week 6: Fine-tune Kimi K2 with CRI data

Phase 4 — Evaluation (Weeks 6-8):
- Week 6-7: Run all 30 configurations through evaluation suite
- Week 7-8: Statistical analysis, effect sizes, interaction effects

Phase 5 — Agentforce Validation (Weeks 8-10):
- Week 8-9: Deploy best CRI-tuned model in simulated Agentforce scenarios
- Week 9-10: Qualitative assessment with banking domain experts

Phase 6 — Writing (Weeks 10-14):
- Results chapter, methodology refinement, discussion of findings

Total estimated cloud GPU cost: $300-500
Total timeline: ~14 weeks (3.5 months)""",

    # ── Post-Training Fine-Tuning Strategy ──
    """CRI EXPERIMENT — Fine-Tuning Strategy Details:
Method: QLoRA (Quantized Low-Rank Adaptation)
Reference: Dettmers et al. (2023) "QLoRA: Efficient Finetuning of Quantized LLMs"

Configuration:
- Base quantization: 4-bit NormalFloat (NF4)
- LoRA rank: 64 (higher than typical 16-32 for multi-objective CRI training)
- LoRA alpha: 128 (2× rank)
- Target modules: q_proj, k_proj, v_proj, o_proj, gate_proj, up_proj, down_proj
- Learning rate: 2e-4 with cosine schedule
- Batch size: 4 (gradient accumulation 8 for effective batch 32)
- Epochs: 3 per CRI dataset component
- Training approach: Sequential — Correctness → Faithfulness → Stability → Compliance
  (ordered by foundation → specialized)

Alternative approaches to compare:
1. DPO (Direct Preference Optimization) on CRI preference pairs
2. Multi-task training (all 4 CRI components simultaneously)
3. Curriculum learning (easy → hard examples within each component)

The sequential approach is the baseline; DPO and multi-task are ablations
that test whether training structure affects CRI dimension improvements.

Memory requirements:
- Mistral 7B QLoRA: ~12GB VRAM (fits M5 MacBook with MPS for testing)
- LLaMA 3.1 8B QLoRA: ~14GB VRAM (tight on M5, comfortable on cloud)
- Kimi K2 QLoRA: TBD (depends on model size, likely needs cloud)""",
]

# ── Seed everything ─────────────────────────────────────────────────────

print("Seeding CRI experiment design...")
for i, exp in enumerate(experiments, 1):
    remember(exp, domain="research")
    remember(exp, domain="coding")  # AutoResearch Trainer needs this too
    print(f"  ✓ Experiment component {i}/6 seeded (research + coding)")

# ── Preferences ─────────────────────────────────────────────────────────

prefs = {
    "cri_base_models": "Mistral 7B v0.3, LLaMA 3.1 8B, Kimi K2",
    "cri_finetuning_method": "QLoRA (4-bit NF4, rank 64, alpha 128)",
    "cri_decoding_strategies": "greedy, top-p(0.9), top-k(50), DoLa, Mirostat v2",
    "cri_training_data_size": "~7000 examples across 4 CRI dimensions",
    "cri_eval_benchmarks": "TruthfulQA, FActScore, AgentBench, SWE-bench Lite, HaluEval + custom CRI-Banking suite",
    "cri_cloud_gpu": "Lambda Labs H100 (~$2.50/hr), estimated total $300-500",
    "cri_experiment_configs": "30 (3 models × 2 conditions × 5 decodings)",
    "cri_timeline": "~14 weeks / 3.5 months",
    "autoresearch_repo": "github.com/WadeLovell/autoresearch",
    "autoresearch_new_files": "cri_train.py, cri_prepare.py, cri_program.md, cri_eval.py, experiment_tracker.py",
}

print("\nSetting experiment preferences...")
for key, val in prefs.items():
    set_preference(key, val)
    print(f"  ✓ {key}")

print()
print("═" * 60)
print(f"  ✅ Seeded 6 experiment components + {len(prefs)} preferences")
print("  PhD Researcher + AutoResearch Trainer agents now have")
print("  full experiment context for Mon/Wed/Sat updates")
print("═" * 60)
