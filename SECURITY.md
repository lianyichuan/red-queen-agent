# Security and local data

Red Queen launches an agent CLI using the current user's account. The default full-access sandbox can execute commands and modify files beyond this repository. Use the execution sandbox setting appropriate to your environment; personality instructions do not enforce access control.

Never include credentials, local provider configuration, speech history, execution logs or private screenshots in an issue or pull request. The repository does not contain runtime credentials. scripts/gen.sh reads optional image-generation credentials from environment variables.

User directives and task context may be sent to the configured model provider. Spoken replies use an online synthesis service. Optional Rex logs can contain command outputs and task content, even though common credential patterns are redacted. Inspect logs before sharing them.

To report a suspected credential exposure, contact the repository owner privately rather than publishing the credential in an issue.
