# Backend Guidelines

The uTools preload bridge owns host APIs, filesystem access, Git, and local
persistence. The optional Go Project Launch Service owns delegated processes and
automation when service mode is enabled.

| Guide                                                 | Scope                                |
| ----------------------------------------------------- | ------------------------------------ |
| [Directory Structure](./directory-structure.md)       | Preload and service ownership        |
| [Storage Guidelines](./database-guidelines.md)        | Local persistence and migrations     |
| [Error Handling](./error-handling.md)                 | Errors across the bridge and service |
| [Project Launch Service](./project-launch-service.md) | Service protocol and lifecycle       |
| [Quality Guidelines](./quality-guidelines.md)         | Backend validation                   |
| [Logging Guidelines](./logging-guidelines.md)         | Diagnostics and secret handling      |
