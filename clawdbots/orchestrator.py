# orchestrator.py — The Routing Brain for ClawdBots
# Uses local Ollama (Mistral) for fast, free routing decisions
# Then dispatches to Claude-powered specialist agents

import json
import re
from agents import invoke_agent, AGENTS, list_agents

try:
    import ollama as oll
    LOCAL_AVAILABLE = True
except Exception:
    LOCAL_AVAILABLE = False

# ── Routing Prompt ────────────────────────────────────────────────────
ROUTER_PROMPT = """You are the routing engine for a personal AI agent system.
Given a user request, decide which agent(s) should handle it.

Available agents:
{agent_descriptions}

RULES:
- Choose the SINGLE best agent for most requests
- Only use multiple agents if the request clearly spans different domains
- If the request is a general question or preference update, use "coordinator"
- If unsure, default to "coordinator"

Respond with ONLY valid JSON, no other text:
{{
    "plan": [
        {{"agent": "agent_key", "task": "what this agent should do"}}
    ]
}}"""


def _build_agent_descriptions() -> str:
    """Build a concise description of available agents for the router."""
    lines = []
    for key, agent in AGENTS.items():
        # Extract first sentence of system prompt as description
        first_line = agent["system"].split("\n")[0]
        lines.append(f'- "{key}": {first_line}')
    return "\n".join(lines)


def _route_with_ollama(user_input: str) -> list[dict]:
    """Use local Mistral model to decide routing. Free and fast."""
    prompt = ROUTER_PROMPT.format(agent_descriptions=_build_agent_descriptions())

    response = oll.chat(
        model="mistral",
        messages=[
            {"role": "system", "content": prompt},
            {"role": "user", "content": user_input},
        ],
        options={"temperature": 0.1},  # low temp for consistent routing
    )

    raw = response["message"]["content"]

    # Extract JSON from response (Mistral sometimes wraps it in markdown)
    json_match = re.search(r'\{.*\}', raw, re.DOTALL)
    if json_match:
        plan = json.loads(json_match.group())
        return plan.get("plan", [{"agent": "coordinator", "task": user_input}])

    # Fallback: couldn't parse routing, send to coordinator
    return [{"agent": "coordinator", "task": user_input}]


def _route_with_keywords(user_input: str) -> list[dict]:
    """Simple keyword-based fallback router if Ollama is unavailable."""
    lower = user_input.lower()

    # Eurovan
    if any(w in lower for w in ["eurovan", "van", "engine", "gowesty",
                                 "suspension", "radiator", "subaru swap",
                                 "cv joint", "t4"]):
        return [{"agent": "eurovan_engineer", "task": user_input}]

    # PhD / Dissertation
    if any(w in lower for w in ["dissertation", "thesis", "paper", "literature",
                                 "citation", "bibtex", "research gap",
                                 "related work", "reviewer"]):
        return [{"agent": "phd_researcher", "task": user_input}]

    # AutoResearch / ML Training
    if any(w in lower for w in ["autoresearch", "karpathy", "experiment",
                                 "training run", "hyperparameter", "fine-tune",
                                 "ablation", "loss curve", "epoch"]):
        return [{"agent": "autoresearch_trainer", "task": user_input}]

    # Coding
    if any(w in lower for w in ["code", "script", "debug", "function", "api",
                                 "python", "javascript", "git", "deploy",
                                 "refactor", "bug", "class", "module"]):
        return [{"agent": "coder", "task": user_input}]

    # Packing
    if any(w in lower for w in ["pack", "packing list", "what to bring",
                                 "gear list", "carry-on", "luggage",
                                 "what should i take"]):
        return [{"agent": "packing_agent", "task": user_input}]

    # Trip Planning
    if any(w in lower for w in ["trip", "travel", "flight", "hotel", "itinerary",
                                 "destination", "vacation", "road trip", "camping",
                                 "route", "airbnb"]):
        return [{"agent": "trip_planner", "task": user_input}]

    # Writing
    if any(w in lower for w in ["write", "draft", "email", "blog post", "edit",
                                 "proofread", "polish", "letter", "document"]):
        return [{"agent": "writer", "task": user_input}]

    # Daily Brief
    if any(w in lower for w in ["brief", "morning", "summary", "status update",
                                 "what's going on", "catch me up", "overview"]):
        return [{"agent": "daily_brief", "task": user_input}]

    # Research (general)
    if any(w in lower for w in ["research", "compare", "evaluate", "benchmark",
                                 "review", "analysis", "investigate",
                                 "fact check", "specs"]):
        return [{"agent": "research_analyst", "task": user_input}]

    # Life Admin
    if any(w in lower for w in ["remind", "todo", "to-do", "schedule",
                                 "appointment", "errand", "task list",
                                 "priority", "deadline"]):
        return [{"agent": "life_admin", "task": user_input}]

    # Memory Curator
    if any(w in lower for w in ["improve", "self-improve", "optimize agents",
                                 "consolidate memory", "agent performance",
                                 "tune prompts"]):
        return [{"agent": "memory_curator", "task": user_input}]

    return [{"agent": "coordinator", "task": user_input}]


def route(user_input: str) -> list[dict]:
    """Route a request to the appropriate agent(s)."""
    if LOCAL_AVAILABLE:
        try:
            return _route_with_ollama(user_input)
        except Exception as e:
            print(f"  ⚠  Ollama routing failed ({e}), using keyword fallback")
            return _route_with_keywords(user_input)
    else:
        return _route_with_keywords(user_input)


def execute(user_input: str) -> list[dict]:
    """Route and execute a user request. Returns list of agent results."""
    plan = route(user_input)
    results = []

    for step in plan:
        agent_name = step.get("agent", "coordinator")
        task = step.get("task", user_input)

        # Validate agent exists
        if agent_name not in AGENTS:
            agent_name = "coordinator"

        result = invoke_agent(agent_name, task)
        results.append(result)

    return results


# ── Direct Agent Access ───────────────────────────────────────────────

def ask(agent_name: str, message: str) -> dict:
    """Bypass routing and talk directly to a specific agent."""
    return invoke_agent(agent_name, message)


if __name__ == "__main__":
    # Test routing
    test_queries = [
        "What mods should I do to my Eurovan first?",
        "Write a Python script to parse CSV files",
        "Plan a 5-day trip to Yosemite in the Eurovan",
        "What's the weather like today?",
        "Pack for a week-long backpacking trip in Patagonia",
        "Review the latest transformer architecture papers",
        "Run an ablation study on the learning rate",
        "Draft an email to my advisor about the timeline",
        "Give me my morning brief",
        "Compare NVIDIA Jetson vs Mac Mini for always-on AI",
        "Remind me to renew my passport next week",
        "How can we improve agent routing accuracy?",
    ]

    print("Routing test (12 agents):")
    for q in test_queries:
        plan = route(q)
        agents = [s["agent"] for s in plan]
        print(f"  \"{q[:55]}...\" → {agents}")
