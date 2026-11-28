# Files and images

Attach up to 5 files, 4 MB together, to a message: pick, paste or drop them.

Every file is saved in the sandbox (outside the repository), so any model can work with it through its
tools. A model that can read a file is also given it directly:

| Model | Images | PDF | Audio and video | Looks at images it opens and app screenshots |
|---|---|---|---|---|
| DeepSeek Flash | yes | no | no | yes |
| DeepSeek V4 Pro | no | no | no | no |
| Own OpenAI or Anthropic key | per model list | per model list | no | with images |
| Own Google key | per model list | per model list | per model list | with images |
| Own OpenAI-compatible address | if ticked | no | no | no |

A model that is not in the public list is assumed to read images and PDFs (OpenAI, Anthropic, Google).
Short text files are also written into the message. For anything else the agent uses its tools, for example
installing a library to read a PDF, which may not succeed.

The file type comes from the contents, not the name. Files are stored in Postgres, shown only to the
chat's owner, deleted with the chat or account, and sent to the model provider. At most 12 MB of files go
into one model request, newest first.

Not built: attachments from GitHub, Slack, Discord or Telegram, a removal period, and images or audio as
output.
