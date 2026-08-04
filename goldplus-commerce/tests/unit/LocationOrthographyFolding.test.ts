import { describe, it, expect } from 'vitest';
import {
  foldUgandanOrthography as fold,
  normaliseLocationText,
  buildSearchText,
} from '../../packages/shared/src/locations/folding';

/**
 * Location-module brief PART F.2: every folding rule unit-tested with real
 * names from the dataset, both directions, plus the three known false-positive
 * traps as explicit NEGATIVE tests.
 */
describe('Ugandan orthography folding — positive rules', () => {
  const same = (a: string, b: string) => expect(fold(a)).toBe(fold(b));

  it('L and R interchange', () => {
    same('Lubaga', 'Rubaga');
    same('Kalerwe', 'Karerwe');
  });

  it('doubled consonants collapse', () => {
    same('Matugga', 'Matuga');
    same('Najjera', 'Najera');
    same('Kajjansi', 'Kajansi');
    same('Ggaba', 'Gaba');
    same('Bbunga', 'Bunga');
    same('Kkonko', 'Konko');
  });

  it('leading vowel dropped or added', () => {
    same('Entebbe', 'Ntebbe');
  });

  it('ny/nny and ng/ng’ fold together', () => {
    same('Bunnamwaya', 'Bunamwaya');
    same("Kalang'ala", 'Kalangala');
  });

  it('ki/ky, bi/by, gi/gy before vowels', () => {
    same('Kyebando', 'Kiebando');
    same('Byakabanda', 'Biakabanda');
  });

  it('w doubling', () => {
    same('Bunamwaya', 'Bunamwaaya');
  });

  it('long vowels written single or double', () => {
    same('Naalya', 'Nalya');
    same('Kisaasi', 'Kisasi');
    same('Kasaana', 'Kasana');
  });

  it('terminal -e / -ye variance', () => {
    same('Kyebando', 'Kyebandoe');
  });

  it('brief PART N item 7 resolution set folds to its canonical spellings', () => {
    // NOTE: bugolobi/Bogolobi is a VOWEL variant (u↔o), not an orthography
    // rule — the brief resolves it through the stored source spelling +
    // trigram similarity, proven at the search-service layer in stage 3.
    same('lubaga', 'Rubaga');
    same('matugga', 'Matuga');
    same('najera', 'Najjera');
    same('kisasi', 'Kisaasi');
    same('gaba', 'Ggaba');
    same('ntebbe', 'Entebbe');
  });
});

describe('Ugandan orthography folding — the three false-positive traps stay distinct', () => {
  const distinct = (a: string, b: string) => expect(fold(a)).not.toBe(fold(b));

  it('Bunga does not collapse into Busanga', () => distinct('Bunga', 'Busanga'));
  it('Kasangati does not collapse into Kasana', () => distinct('Kasangati', 'Kasana'));
  it('Namasuba does not collapse into Namayuba', () => distinct('Namasuba', 'Namayuba'));
});

describe('normalisation + search text', () => {
  it('normalises case, punctuation and whitespace', () => {
    expect(normaliseLocationText('  KIRA   town,  (Wakiso) ')).toBe('kira town wakiso');
  });
  it('is pure and deterministic', () => {
    expect(fold('Najjera')).toBe(fold('Najjera'));
  });
  it('buildSearchText folds, dedupes and skips blanks', () => {
    const text = buildSearchText(['Najjera', 'Najera', null, '', 'Wakiso']);
    expect(text.split(' ')).toContain(fold('Najjera'));
    expect(text.split(' ').filter((t) => t === fold('Najjera'))).toHaveLength(1);
  });
  it('folding never produces empty for a real name', () => {
    for (const name of ['Ntinda', 'Kireka', 'Bweyogerere', 'Kajjansi', 'Namugongo', 'Seeta']) {
      expect(fold(name).length).toBeGreaterThan(1);
    }
  });
});
