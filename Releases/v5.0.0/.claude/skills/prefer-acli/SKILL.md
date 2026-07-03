\---

name: prefer-acli

description: Always prefer `acli jira workitem` over Atlassian MCP for Jira operations. Use MCP only for sprint assignment, worklogs, transitions with custom fields, or getting accountId.

\---



\# Jira via acli



Prefer acli over `mcp\_\_claude\_ai\_Atlassian\_\_\*`. Use MCP only when noted below.



```

\# View

acli jira workitem view KEY-123 --fields summary,status,assignee,description

acli jira workitem view KEY-123 --json



\# Search (handles sprint/board queries too)

acli jira workitem search --jql "project = TOSCA AND assignee = currentUser()" --fields key,summary,status --json

acli jira workitem search --jql "..." --count



\# Comment

acli jira workitem comment create --key KEY-123 --body "text"

acli jira workitem comment list   --key KEY-123

acli jira workitem comment update --key KEY-123 --comment-id <id> --body "new text"

acli jira workitem comment delete --key KEY-123 --comment-id <id>



\# Transition / assign

acli jira workitem transition --key KEY-123 --status "In Progress"

acli jira workitem assign     --key KEY-123 --accountId <accountId>



\# Create / edit

acli jira workitem create --project TOSCA --summary "title" --type Story

acli jira workitem edit   --key KEY-123 --summary "new title"

\# Custom fields: use --from-json (generate template with --generate-json); prefer MCP for complex cases



\# Attachments

acli jira workitem attachment list   --key KEY-123

acli jira workitem attachment delete --key KEY-123 --attachment-id <id>

```



\## MCP fallbacks



| Need | MCP tool |

|---|---|

| Set sprint, components, fixVersions | `editJiraIssue` |

| Transition + set custom field | `transitionJiraIssue` |

| Get current user's accountId | `atlassianUserInfo` |

| Add worklog | `addWorklogToJiraIssue` |

