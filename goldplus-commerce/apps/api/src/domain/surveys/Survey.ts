import { createHash } from 'node:crypto';

export type SurveyStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'ACTIVE' | 'PAUSED' | 'CLOSED' | 'REJECTED';
export type SurveyQuestionType = 'SINGLE_CHOICE' | 'MULTI_CHOICE' | 'SCALE';
export interface SurveyQuestion { key: string; prompt: string; type: SurveyQuestionType; required: boolean; options?: string[]; min?: number; max?: number; }
export interface SurveyAudience { lifecycleStages: string[]; }

const keyPattern = /^[a-z][a-z0-9_]{1,39}$/;
const forbidden = /(email|phone|telephone|address|name|contact|password|secret|token|national id|passport)/i;

export function validateSurveyQuestions(questions: SurveyQuestion[]): string[] {
  const errors: string[] = [];
  if (questions.length < 1 || questions.length > 30) errors.push('A survey requires between 1 and 30 questions.');
  const keys = new Set<string>();
  for (const question of questions) {
    if (!keyPattern.test(question.key) || keys.has(question.key)) errors.push('Question keys must be unique bounded identifiers.');
    keys.add(question.key);
    if (question.prompt.trim().length < 3 || question.prompt.length > 300 || forbidden.test(question.prompt)) errors.push(`${question.key || 'Question'} must use bounded non-PII wording.`);
    if (question.type === 'SCALE') {
      if (!Number.isInteger(question.min) || !Number.isInteger(question.max) || question.min! < 0 || question.max! > 10 || question.min! >= question.max!) errors.push(`${question.key} requires a scale between 0 and 10.`);
    } else {
      const options = question.options ?? [];
      if (options.length < 2 || options.length > 12 || new Set(options).size !== options.length || options.some((option) => option.trim().length < 1 || option.length > 100 || forbidden.test(option))) errors.push(`${question.key} requires 2–12 distinct bounded non-PII options.`);
    }
  }
  return [...new Set(errors)];
}

export function validateSurveyAnswers(questions: SurveyQuestion[], answers: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (Object.keys(answers).some((key) => !questions.some((question) => question.key === key))) errors.push('Answers contain an unknown question.');
  for (const question of questions) {
    const answer = answers[question.key];
    if (answer === undefined || answer === null) { if (question.required) errors.push(`${question.key} is required.`); continue; }
    if (question.type === 'SCALE') {
      if (!Number.isInteger(answer) || Number(answer) < question.min! || Number(answer) > question.max!) errors.push(`${question.key} is outside its scale.`);
    } else if (question.type === 'SINGLE_CHOICE') {
      if (typeof answer !== 'string' || !question.options!.includes(answer)) errors.push(`${question.key} is not an allowed option.`);
    } else {
      if (!Array.isArray(answer) || answer.length < 1 || answer.length > question.options!.length || new Set(answer).size !== answer.length || answer.some((value) => typeof value !== 'string' || !question.options!.includes(value))) errors.push(`${question.key} contains an invalid selection.`);
    }
  }
  return errors;
}

export function surveyVersionDigest(input: { title: string; description: string; questions: SurveyQuestion[]; audience: SurveyAudience }): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

export function surveyParticipantHash(userId: string): string {
  return createHash('sha256').update(`survey-participant:v1:${userId}`).digest('hex');
}
