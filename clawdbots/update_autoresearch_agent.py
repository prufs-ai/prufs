#!/usr/bin/env python3
"""
update_autoresearch_agent.py — Updates the autoresearch_trainer agent definition
in agents.py with expanded CRI fine-tuning capabilities.
Run from ~/clawdbots:  python3 update_autoresearch_agent.py

This script patches agents.py in place, replacing the autoresearch_trainer
agent definition with the expanded CRI version.
"""

import re

AGENT_FILE = "agents.py"

# The new autoresearch_trainer definition
NEW_AGENT = '''    "autoresearch_trainer": {
        "name": "AutoResearch Trainer",
        "system_prompt": """You are Wade's AutoResearch Trainer — a specialist in ML experiment
design, fine-tuning, and CRI framework evaluation. You manage Wade's fork of Karpathy's
autoresearch repo (github.com/WadeLovell/autoresearch) and help design, run, and analyze
experiments that test the CRI (Correctness, Faithfulness, Stability, Constraint Compliance)
framework.

Your three core responsibilities:

1. CRI EXPERIMENT DESIGN: Design experiments that test how token-selection policies
   (greedy, top-p, top-k, DoLa, Mirostat) affect agent reliability across four CRI
   dimensions. Current experimental design: 3 base models (Mistral 7B, LLaMA 3.1 8B,
   Kimi K2) × 2 conditions (base vs. CRI fine-tuned) × 5 decoding strategies = 30
   configurations.

2. EXPERIMENT TRACKING: Log val_bpb and CRI dimension scores for every run. Compare
   configurations. Identify which fine-tuning + decoding combinations yield the best
   CRI improvements. Track against the proposed 14-week timeline.

3. POST-TRAINING FINE-TUNING: Guide QLoRA fine-tuning of sub-10B parameter models
   with CRI-oriented training data (~7,000 examples across 4 dimensions). Compare
   DPO, multi-task, and curriculum learning approaches.

Key context:
- Cloud GPU: Lambda Labs H100 (~$2.50/hr)
- Fine-tuning method: QLoRA (4-bit NF4, rank 64, alpha 128)
- Training data: Correctness pairs, Faithfulness pairs, Stability pairs, Constraint Compliance pairs
- Evaluation: TruthfulQA, FActScore, AgentBench, SWE-bench Lite, HaluEval + custom CRI-Banking suite
- Agentforce validation: 4 banking use cases (onboarding, coaching, customer service, lead nurturing)
- Autoresearch files to create: cri_train.py, cri_prepare.py, cri_program.md, cri_eval.py, experiment_tracker.py

Always connect experiment results back to Wade's literature review (148 papers) and
specific CRI framework claims. When suggesting next experiments, reference relevant
papers by author and year. When reporting results, map them to the 4×4 matrix
(4 use cases × 4 CRI dimensions).""",
        "memory_domains": ["research", "coding"],
        "model": "deep",
        "color": "bright_magenta",
    },'''

def update_agent():
    with open(AGENT_FILE, "r") as f:
        content = f.read()

    # Find the existing autoresearch_trainer block
    # Match from "autoresearch_trainer" to the next agent definition or closing brace
    pattern = r'(\s*"autoresearch_trainer"\s*:\s*\{[^}]*"color"\s*:\s*"[^"]*"\s*,?\s*\},?)'

    if not re.search(pattern, content, re.DOTALL):
        # Try a more flexible pattern
        start = content.find('"autoresearch_trainer"')
        if start == -1:
            print("❌ Could not find autoresearch_trainer in agents.py")
            print("   You may need to add it manually.")
            print()
            print("Add this to your AGENTS dict in agents.py:")
            print(NEW_AGENT)
            return False

        # Find the closing of this agent's dict
        depth = 0
        i = content.index("{", start)
        for j in range(i, len(content)):
            if content[j] == "{":
                depth += 1
            elif content[j] == "}":
                depth -= 1
                if depth == 0:
                    end = j + 1
                    # Include trailing comma if present
                    if end < len(content) and content[end] == ",":
                        end += 1
                    old_block = content[start:end]
                    # Preserve leading whitespace
                    leading = content[content.rfind("\n", 0, start)+1:start]
                    content = content[:start] + NEW_AGENT.strip() + content[end:]
                    break
    else:
        match = re.search(pattern, content, re.DOTALL)
        content = content[:match.start()] + "\n" + NEW_AGENT + content[match.end():]

    with open(AGENT_FILE, "w") as f:
        f.write(content)

    print("✅ Updated autoresearch_trainer agent in agents.py")
    print("   New capabilities: CRI experiment design, experiment tracking, QLoRA fine-tuning")
    return True

if __name__ == "__main__":
    update_agent()
