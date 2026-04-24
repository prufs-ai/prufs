#!/usr/bin/env python3
# main.py — Terminal Interface for ClawdBots
# The command center for Wade's personal AI agent system

from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.markdown import Markdown
from rich import box

from orchestrator import execute, ask, route
from agents import list_agents, AGENTS
from memory import remember, recall, memory_stats, set_preference, get_preference

console = Console()

# ── Banner ─────────────────────────────────────────────────────────────
BANNER = """
   _____ _                     _ ____        _
  / ____| |                   | |  _ \\      | |
 | |    | | __ ___      ___ __| | |_) | ___ | |_ ___
 | |    | |/ _` \\ \\ /\\ / / '__| |  _ < / _ \\| __/ __|
 | |____| | (_| |\\ V  V /| |  | | |_) | (_) | |_\\__ \\
  \\_____|_|\\__,_| \\_/\\_/ |_|  |_|____/ \\___/ \\__|___/
"""

HELP_TEXT = """
Commands:
  /agents          List all available agents
  /ask <agent> ... Talk directly to a specific agent (bypass routing)
  /memory          Show memory statistics
  /remember ...    Manually store a memory
  /recall ...      Search memories
  /pref <k> <v>   Set a preference
  /stats           Show session statistics
  /help            Show this help
  /quit            Exit

Just type naturally and the system will route to the right agent.
"""


# ── Session Stats ──────────────────────────────────────────────────────
session_stats = {
    "queries": 0,
    "total_tokens_in": 0,
    "total_tokens_out": 0,
    "agents_used": {},
}


def update_stats(results: list[dict]):
    """Track session usage."""
    session_stats["queries"] += 1
    for r in results:
        session_stats["total_tokens_in"] += r.get("tokens_in", 0)
        session_stats["total_tokens_out"] += r.get("tokens_out", 0)
        agent = r.get("agent", "unknown")
        session_stats["agents_used"][agent] = session_stats["agents_used"].get(agent, 0) + 1


# ── Command Handlers ──────────────────────────────────────────────────

def cmd_agents():
    """Display available agents."""
    table = Table(title="Available Agents", box=box.ROUNDED)
    table.add_column("Key", style="bold")
    table.add_column("Name")
    table.add_column("Memory Domains")

    for agent in list_agents():
        table.add_row(
            agent["key"],
            f"[{agent['color']}]{agent['name']}[/]",
            ", ".join(agent["domains"]),
        )
    console.print(table)


def cmd_memory():
    """Display memory statistics."""
    stats = memory_stats()
    table = Table(title="Memory Stats", box=box.ROUNDED)
    table.add_column("Domain", style="bold")
    table.add_column("Entries", justify="right")

    for domain, count in stats.items():
        table.add_row(domain, str(count))
    console.print(table)


def cmd_stats():
    """Display session statistics."""
    table = Table(title="Session Stats", box=box.ROUNDED)
    table.add_column("Metric", style="bold")
    table.add_column("Value", justify="right")

    table.add_row("Total queries", str(session_stats["queries"]))
    table.add_row("Tokens in", f"{session_stats['total_tokens_in']:,}")
    table.add_row("Tokens out", f"{session_stats['total_tokens_out']:,}")

    est_cost = (session_stats["total_tokens_in"] * 0.003 / 1000 +
                session_stats["total_tokens_out"] * 0.015 / 1000)
    table.add_row("Est. API cost", f"${est_cost:.4f}")
    console.print(table)

    if session_stats["agents_used"]:
        console.print("\n[bold]Agent usage:[/]")
        for agent, count in sorted(session_stats["agents_used"].items(),
                                   key=lambda x: -x[1]):
            console.print(f"  {agent}: {count} calls")


def cmd_ask(parts: list[str]):
    """Direct message to a specific agent."""
    if len(parts) < 2:
        console.print("[red]Usage: /ask <agent_name> <message>[/]")
        return

    agent_name = parts[0]
    message = " ".join(parts[1:])

    if agent_name not in AGENTS:
        console.print(f"[red]Unknown agent '{agent_name}'. Use /agents to see available agents.[/]")
        return

    agent_info = AGENTS[agent_name]
    console.print(f"  [dim]Asking {agent_info['name']} directly...[/]")

    result = ask(agent_name, message)
    display_result(result)
    update_stats([result])


def cmd_remember(text: str):
    """Manually store a memory."""
    doc_id = remember(text, domain="general", metadata={"source": "manual"})
    console.print(f"  [green]Stored in general memory (id: {doc_id})[/]")


def cmd_recall(query: str):
    """Search memories."""
    results = recall(query, domain="general", n_results=5)
    if results:
        console.print(f"  [bold]Found {len(results)} memories:[/]")
        for i, mem in enumerate(results, 1):
            console.print(f"  {i}. {mem[:150]}...")
    else:
        console.print("  [dim]No matching memories found.[/]")


def cmd_pref(parts: list[str]):
    """Set or view a preference."""
    if len(parts) < 2:
        console.print("[red]Usage: /pref <key> <value>[/]")
        return
    key = parts[0]
    value = " ".join(parts[1:])
    set_preference(key, value)
    console.print(f"  [green]Preference set: {key} = {value}[/]")


# ── Display ────────────────────────────────────────────────────────────

def display_result(result: dict):
    """Render an agent's response."""
    agent_name = result.get("agent", "unknown")
    agent_info = AGENTS.get(agent_name, {})
    color = agent_info.get("color", "white")
    display_name = agent_info.get("name", agent_name)
    tokens = result.get("tokens_in", 0) + result.get("tokens_out", 0)

    subtitle = f"[dim]{result.get('model', '')} | {tokens:,} tokens[/]" if tokens else ""

    console.print(Panel(
        Markdown(result["response"]),
        title=f"[bold {color}]{display_name}[/]",
        subtitle=subtitle,
        border_style=color,
        padding=(1, 2),
    ))


# ── Main Loop ──────────────────────────────────────────────────────────

def main():
    console.print(BANNER, style="bold cyan")
    console.print("[dim]Type /help for commands, or just ask me anything.[/]\n")

    while True:
        try:
            user_input = console.input("[bold cyan]Wade>[/] ").strip()
        except (KeyboardInterrupt, EOFError):
            console.print("\n[dim]Goodbye![/]")
            break

        if not user_input:
            continue

        # Handle commands
        if user_input.startswith("/"):
            parts = user_input.split()
            cmd = parts[0].lower()

            if cmd in ("/quit", "/exit", "/q"):
                console.print("[dim]Goodbye![/]")
                break
            elif cmd == "/help":
                console.print(Panel(HELP_TEXT, title="Help", border_style="dim"))
            elif cmd == "/agents":
                cmd_agents()
            elif cmd == "/memory":
                cmd_memory()
            elif cmd == "/stats":
                cmd_stats()
            elif cmd == "/ask":
                cmd_ask(parts[1:])
            elif cmd == "/remember":
                cmd_remember(" ".join(parts[1:]))
            elif cmd == "/recall":
                cmd_recall(" ".join(parts[1:]))
            elif cmd == "/pref":
                cmd_pref(parts[1:])
            else:
                console.print(f"[red]Unknown command: {cmd}. Type /help for help.[/]")
            continue

        # Route and execute
        plan = route(user_input)
        agent_names = [s["agent"] for s in plan]
        console.print(f"  [dim]Routing → {', '.join(agent_names)}[/]")

        results = execute(user_input)
        for result in results:
            display_result(result)

        update_stats(results)


if __name__ == "__main__":
    main()
