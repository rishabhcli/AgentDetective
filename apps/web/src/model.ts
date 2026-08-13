export type Selection =
  | { type: 'entity'; id: string }
  | { type: 'edge'; id: string }
  | { type: 'evidence'; id: string }
  | { type: 'claim'; id: string }
  | { type: 'observation'; id: string }
  | { type: 'reference'; id: string }
  | { type: 'assumption'; id: string }
  | { type: 'belief'; id: string }
  | { type: 'belief-edge'; id: string };

export type DrawerId =
  | 'upload'
  | 'changes'
  | 'status'
  | 'observability'
  | 'interview'
  | 'scenarios'
  | 'deductions'
  | null;
