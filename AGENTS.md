# KeiAI

Local-first AI character chat application.

## Projects

| Path          | Responsibility                                                    | Local instructions                             |
| ------------- | ----------------------------------------------------------------- | ---------------------------------------------- |
| `app/`        | Client, domain logic, local storage, encryption, sync, AI runtime | [`app/AGENTS.md`](app/AGENTS.md)               |
| `pocketbase/` | Authentication and encrypted data storage                         | [`pocketbase/AGENTS.md`](pocketbase/AGENTS.md) |
| `proxy/`      | Stateless request forwarding                                      | [`proxy/AGENTS.md`](proxy/AGENTS.md)           |

Read the nearest `AGENTS.md` before changing a project.

## Repository rules

- Good definitions make rules follow naturally and reduce code.
- Use consistent names, shapes, contracts, and behavior across the repository.
- Add complexity only for a current requirement and only when it reduces greater complexity. Do not future-proof hypothetical needs.
- Add tests or documentation ONLY when they protect a meaningful contract.
