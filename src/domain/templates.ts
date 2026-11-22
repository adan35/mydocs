/** Built-in document templates. Data-driven: adding a template is adding an entry here. */

export interface Template {
  id: string;
  name: string;
  description: string;
  /** Suggested file name (without extension); `{{date}}` is expanded. */
  fileName: string;
  body: string;
}

export const TEMPLATES: Template[] = [
  {
    id: 'blank',
    name: 'Blank document',
    description: 'Start from an empty page.',
    fileName: 'Untitled',
    body: '# {{title}}\n\n',
  },
  {
    id: 'readme',
    name: 'README',
    description: 'Project overview with setup and usage.',
    fileName: 'README',
    body: `# {{title}}

A short description of what this project does and who it is for.

## Getting started

\`\`\`bash
# install
\`\`\`

## Usage

## Contributing

## License
`,
  },
  {
    id: 'meeting',
    name: 'Meeting notes',
    description: 'Agenda, notes, decisions and action items.',
    fileName: 'Meeting {{date}}',
    body: `# {{title}}

- **Date:** {{date}}
- **Attendees:** 

## Agenda

1. 

## Notes

## Decisions

## Action items

- [ ] 
`,
  },
  {
    id: 'minutes',
    name: 'Meeting minutes',
    description: 'Formal minutes: attendees, agenda, decisions, action items and next steps.',
    fileName: 'Meeting minutes {{date}}',
    body: `---
type: meeting-minutes
date: {{date}}
status: draft
---

# {{title}}

> [!NOTE] Purpose
> One sentence on why this meeting was held and what it needed to decide.

- 📅 **Date:** {{date}}
- 🕒 **Time:** {{time}} –
- 📍 **Location:** Room or video link
- 🧭 **Chair:** 
- ✍️ **Minutes by:** 

## 👥 Attendees

| Name | Role | Attendance |
| --- | --- | :---: |
|  |  | ✅ Present |
|  |  | ⏳ Late |
|  |  | ❌ Absent |

## 📋 Agenda

1.
2.
3.

## 💬 Discussion

### 1. Topic

- **Summary:**
- **Points raised:**
  -

> [!TIP] Key takeaway
> The one thing everybody should remember from this item.

## ✅ Decisions

| # | Decision | Decided by |
| ---: | --- | --- |
| 1 |  |  |

## 🎯 Action items

| Action | Owner | Due | Status |
| --- | --- | --- | :---: |
|  |  |  | ⬜ To do |

- [ ]

## 🅿️ Parking lot

Topics raised but not discussed. Carry them to the next meeting.

-

## 🔜 Next meeting

- **When:**
- **Focus:**

---

*Minutes taken {{date}}. Please send corrections to the chair within two working days.*

#meeting
`,
  },
  {
    id: 'project',
    name: 'Project documentation',
    description: 'Goals, scope, architecture and milestones.',
    fileName: 'Project overview',
    body: `# {{title}}

Created: {{date}}

## Overview

## Goals

## Scope

## Architecture

## Milestones

| Milestone | Owner | Due |
| --- | --- | --- |
|  |  |  |

## Open questions
`,
  },
  {
    id: 'api',
    name: 'API documentation',
    description: 'Endpoints, parameters and examples.',
    fileName: 'API',
    body: `# {{title}}

## Authentication

## Endpoints

### \`GET /resource\`

Returns a list of resources.

**Query parameters**

| Name | Type | Description |
| --- | --- | --- |
| \`limit\` | number | Maximum number of results |

**Response**

\`\`\`json
{
  "items": []
}
\`\`\`

## Errors
`,
  },
  {
    id: 'research',
    name: 'Research notes',
    description: 'Question, sources, findings and conclusions.',
    fileName: 'Research notes',
    body: `# {{title}}

Created: {{date}}

## Question

## Sources

- 

## Findings

## Conclusions

## References
`,
  },
  {
    id: 'lecture',
    name: 'Lecture notes',
    description: 'Course, key ideas, formulas and questions to review.',
    fileName: 'Lecture {{date}}',
    body: `# {{title}}

- **Course:** 
- **Date:** {{date}}

## Key ideas

- 

## Formulas

$$
E = mc^2
$$

## Questions to review

- [ ] 

#lecture
`,
  },
  {
    id: 'daily',
    name: 'Daily note',
    description: 'Focus, tasks and notes for today.',
    fileName: '{{date}}',
    body: `# {{title}}

## Focus

## Tasks

- [ ] 

## Notes
`,
  },
  {
    id: 'todo',
    name: 'Todo list',
    description: 'A simple checklist.',
    fileName: 'Todo',
    body: `# {{title}}

- [ ] 
`,
  },
  {
    id: 'bug',
    name: 'Bug report',
    description: 'Steps to reproduce, expected and actual behavior.',
    fileName: 'Bug {{date}}',
    body: `# {{title}}

**Reported:** {{date}} · **Severity:** 

## Summary

## Steps to reproduce

1. 

## Expected

## Actual

## Environment

## Notes
`,
  },
  {
    id: 'design',
    name: 'Technical design',
    description: 'Context, proposal, alternatives and risks.',
    fileName: 'Technical design',
    body: `---
status: draft
created: {{date}}
---

# {{title}}

## Context

## Goals and non-goals

## Proposal

## Alternatives considered

## Risks and open questions

## Rollout
`,
  },
  {
    id: 'architecture',
    name: 'Software architecture',
    description: 'Components, data flow, decisions and quality attributes.',
    fileName: 'Architecture',
    body: `# {{title}}

## Overview

## Components

| Component | Responsibility | Owner |
| --- | --- | --- |
|  |  |  |

## Data flow

\`\`\`mermaid
flowchart LR
  Client --> API --> Database
\`\`\`

## Key decisions

## Quality attributes

## Deployment
`,
  },
  {
    id: 'prompt',
    name: 'AI prompt',
    description: 'A structured prompt: role, context, task, rules, examples, output and tests.',
    fileName: 'Prompt',
    body: `---
type: prompt
model:
version: 1
status: draft
updated: {{date}}
---

# {{title}}

> **Goal:** one sentence on what this prompt must achieve, for whom, and how you will know it worked.

## How to use this template

1. Fill in the **Prompt** section below. Delete any block you don't need, but keep the order: context first, the task and rules next, the output format last.
2. Replace every \`{{placeholder}}\` with real values, or keep it as a variable your code fills in.
3. Copy everything between the two lines marked \`PROMPT START\` and \`PROMPT END\`.
4. Run it against the **Test cases**, change one thing at a time, and log each change in the **Version log**.

## Prompt

<!-- PROMPT START -->

<role>
You are a {{senior role, for example: senior financial analyst}} with deep experience in {{domain}}. You care most about {{the quality that matters most: accuracy, clarity, safety}}.
</role>

<context>
- **Who this is for:** {{audience, and what they already know}}
- **Why it matters:** {{what the result will be used for, and the decision it supports}}
- **Background:** {{facts, definitions or prior work the model can't guess}}
</context>

<task>
{{One clear instruction that starts with a verb, for example: Summarize the attached report for the board.}}

Work through it in this order:
1. {{First step}}
2. {{Second step}}
3. {{Final step}}
</task>

<input>
{{Paste the document, data or question here. Put long material above the task, inside its own tags.}}
</input>

<constraints>
- Use only the information in <input> and <context>. If something you need is missing, say what is missing instead of guessing.
- Length: {{for example: under 200 words / exactly 5 bullet points}}.
- Tone: {{for example: plain, direct, friendly; no jargon}}.
- Always: {{the must-do rules}}.
- Never: {{the must-not rules}}. For each one, say what to do instead.
</constraints>

<examples>
<example>
<example_input>{{A typical input}}</example_input>
<ideal_output>{{The exact output you want for it}}</ideal_output>
</example>
<example>
<example_input>{{A tricky or edge-case input}}</example_input>
<ideal_output>{{How that case should be handled}}</ideal_output>
</example>
</examples>

<reasoning>
Before answering, think the problem through step by step inside <thinking> tags: check the input, plan the answer and look for edge cases. Then give only the final answer inside <answer> tags.
</reasoning>

<output_format>
Respond in {{Markdown / JSON / plain text}} with exactly this structure:

\`\`\`
## Summary
{{2 or 3 sentences}}

## Key findings
- {{finding, with the evidence for it}}

## Recommended next step
{{one concrete action}}
\`\`\`
</output_format>

<quality_check>
Before you reply, check that the answer:
- does exactly what <task> asks, and nothing it doesn't;
- follows every rule in <constraints>;
- matches <output_format> exactly;
- states assumptions and uncertainty openly, and invents no facts, numbers or sources.
</quality_check>

<!-- PROMPT END -->

## Settings

| Setting | Value | Why |
| --- | --- | --- |
| Model |  |  |
| Temperature | 0 to 0.3 for facts and extraction, 0.7 or more for creative work |  |
| Max output length |  |  |
| Tools / files allowed |  |  |

## Test cases

| # | Input | Expected result | Pass? |
| --- | --- | --- | --- |
| 1 | A typical case |  | [ ] |
| 2 | An edge case (empty, very long, or unusual input) |  | [ ] |
| 3 | Missing information (it should ask or say so, not guess) |  | [ ] |
| 4 | An off-topic or unsafe request (it should decline politely) |  | [ ] |

## Best-practice checklist

- [ ] The task is one clear instruction, written as you would brief a smart new colleague.
- [ ] The context says **why**, not only what, so the model can make good judgment calls.
- [ ] Instructions say what **to do**, not only what to avoid.
- [ ] Each part of the prompt sits in its own tag, and long inputs come before the task.
- [ ] Examples are realistic, varied, and include at least one edge case.
- [ ] The output format is shown, not just described.
- [ ] There is a way out for unclear or missing input ("say what is missing").
- [ ] The prompt was tested on every test case above before being used for real.

## Version log

| Version | Date | Change | Result |
| --- | --- | --- | --- |
| 1 | {{date}} | First draft |  |
`,
  },
];

/** Turns a Markdown file into a template: its first paragraph line describes it. */
export function templateFromFile(id: string, name: string, body: string): Template {
  const description =
    body
      .replace(/^---[\s\S]*?\n---\s*\n/, '')
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('#') && !l.startsWith('---')) ?? 'Your template';
  return {
    id,
    name,
    description: description.length > 90 ? `${description.slice(0, 89)}…` : description,
    fileName: name,
    body,
  };
}

export function isoDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Expands {{title}}, {{date}} and {{time}}. */
export function expandTemplate(
  text: string,
  vars: { title: string; date?: string; time?: string },
): string {
  const date = vars.date ?? isoDate();
  const time = vars.time ?? new Date().toTimeString().slice(0, 5);
  return text.replace(/\{\{\s*(title|date|time)\s*\}\}/g, (_m, key: string) =>
    key === 'title' ? vars.title : key === 'date' ? date : time,
  );
}
