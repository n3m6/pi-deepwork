// Goals interview policy — question set and task-inference heuristic.
// No node:* or pi imports.

export interface InterviewQuestion {
  branch: string;
  title: string;
  question: string;
  required: boolean;
}

export const QUESTION_SET: InterviewQuestion[] = [
  {
    branch: "problem-and-motivation",
    title: "Deepwork: intent",
    question: "What are you building or changing, and why does it matter?",
    required: true,
  },
  {
    branch: "constraints",
    title: "Deepwork: constraints",
    question: "What constraints or limitations must be respected?",
    required: true,
  },
  {
    branch: "non-goals",
    title: "Deepwork: non-goals",
    question: "What is explicitly out of scope for this run?",
    required: true,
  },
  {
    branch: "acceptance-criteria",
    title: "Deepwork: acceptance criteria",
    question: "How will we know this is done? List observable acceptance criteria.",
    required: true,
  },
  {
    branch: "testing-expectations",
    title: "Deepwork: testing expectations",
    question: "What tests or validation should be added or updated?",
    required: true,
  },
];

/**
 * Per-branch inference from the raw user task string.
 * Returns the inferred content if the task text satisfies the branch's heuristic, otherwise undefined.
 */
export function inferFromTask(userTask: string, branch: string): string | undefined {
  const normalized = userTask.trim();
  if (!normalized) {
    return undefined;
  }
  switch (branch) {
    case "problem-and-motivation":
      return normalized;
    case "constraints":
      return /\b(without|must|should not|cannot|don't)\b/i.test(normalized) ? normalized : undefined;
    case "non-goals":
      return /\bout of scope|non-goal|not include\b/i.test(normalized) ? normalized : undefined;
    case "acceptance-criteria":
      return /\bacceptance\b|\bshould\b|\bmust\b/i.test(normalized) ? normalized : undefined;
    case "testing-expectations":
      return /\btest|verify|validation|acceptance\b/i.test(normalized) ? normalized : undefined;
    default:
      return undefined;
  }
}
