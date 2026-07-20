import { describe, expect, it } from 'vitest';
import { surveyParticipantHash, surveyVersionDigest, validateSurveyAnswers, validateSurveyQuestions } from '../../apps/api/src/domain/surveys/Survey';

const questions = [
  { key: 'fit', prompt: 'How well did this fit your needs?', type: 'SCALE' as const, required: true, min: 0, max: 10 },
  { key: 'priority', prompt: 'What matters most?', type: 'SINGLE_CHOICE' as const, required: true, options: ['price', 'quality'] },
];
describe('Survey domain safety', () => {
  it('accepts bounded non-PII questions and exact answers', () => { expect(validateSurveyQuestions(questions)).toEqual([]); expect(validateSurveyAnswers(questions, { fit: 8, priority: 'quality' })).toEqual([]); });
  it('rejects PII solicitation and free-form/unknown answers', () => { expect(validateSurveyQuestions([{ key: 'contact', prompt: 'What is your email address?', type: 'SINGLE_CHOICE', required: true, options: ['yes','no'] }])).not.toEqual([]); expect(validateSurveyAnswers(questions, { fit: 8, priority: 'invented', email: 'x@y.test' })).not.toEqual([]); });
  it('uses stable opaque participant references and deterministic version digests', () => { expect(surveyParticipantHash('a')).toMatch(/^[a-f0-9]{64}$/); expect(surveyParticipantHash('a')).not.toBe(surveyParticipantHash('b')); const input = { title: 'Fit', description: '', questions, audience: { lifecycleStages: ['ACTIVE'] } }; expect(surveyVersionDigest(input)).toBe(surveyVersionDigest(input)); });
});
