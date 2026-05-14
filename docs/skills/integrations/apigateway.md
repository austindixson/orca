# API Gateway (custom)

## No single “AWS API Gateway” Agent Skill

A targeted GitHub pass did **not** surface one canonical **`SKILL.md`** for AWS API Gateway alone. Treat **infra + docs** as primary; add **MCP** or **OpenAPI** skills from upstream when your stack needs them.

| Approach | Use |
|----------|-----|
| **Browser tile** | AWS console, Kong Manager, Traefik dashboard, NGINX Plus/UI, or internal runbooks — **consoles often block iframes**; use **Open in default browser** |
| **Reference skills** | [anthropics/skills](https://github.com/anthropics/skills) — general patterns; read each folder’s `LICENSE` |
| **MCP** | Generic **MCP** servers that wrap **OpenAPI** specs or cloud CLIs — wire in your agent (Hermes, Claude Code, Orca external orchestrator), not inside the tile |
| **OpenAPI** | Design-first: [OpenAPI Specification](https://swagger.io/specification/) — export specs from API Gateway, Kong, etc., and attach to tooling |

## Default wizard URL

Orca ships **AWS API Gateway** console as a **starting point**. Replace the tile URL with **Kong**, **Traefik**, **NGINX**, **Envoy Admin**, or a **private wiki** when that matches your team.

## AWS and vendor docs (external)

- [API Gateway — AWS](https://docs.aws.amazon.com/apigateway/)
- Point the browser tile at the **region-specific console** you use, or at **internal** API design docs.

When a dedicated public **Agent Skill** for your gateway stack appears, add it to [CURATED_SKILL_SOURCES.md](CURATED_SKILL_SOURCES.md).
