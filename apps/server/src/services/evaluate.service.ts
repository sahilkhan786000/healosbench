import type { FieldScores, ExtractionResult } from '@test-evals/shared';
import * as fuzzball from 'fuzzball';

export function evaluateCase(
  prediction: ExtractionResult,
  gold: ExtractionResult,
  transcript: string
): { scores: FieldScores; hallucination_count: number } {
  const scores: FieldScores = {
    chief_complaint: evaluateChiefComplaint(prediction.chief_complaint, gold.chief_complaint),
    vitals: evaluateVitals(prediction.vitals, gold.vitals),
    medications: evaluateMedications(prediction.medications, gold.medications),
    diagnoses: evaluateDiagnoses(prediction.diagnoses, gold.diagnoses),
    plan: evaluatePlan(prediction.plan, gold.plan),
    follow_up: evaluateFollowUp(prediction.follow_up, gold.follow_up),
    overall: 0 // Calculated below
  };

  // Calculate overall score as weighted average
  scores.overall = (
    scores.chief_complaint * 0.2 +
    scores.vitals * 0.15 +
    scores.medications * 0.25 +
    scores.diagnoses * 0.2 +
    scores.plan * 0.1 +
    scores.follow_up * 0.1
  );

  const hallucination_count = detectHallucinations(prediction, transcript);

  return { scores, hallucination_count };
}

function evaluateChiefComplaint(pred: string, gold: string): number {
  // Normalize: lowercase, remove punctuation
  const normalize = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, '').trim();
  const predNorm = normalize(pred);
  const goldNorm = normalize(gold);

  // Use token-set ratio fuzzy match
  return fuzzball.token_set_ratio(predNorm, goldNorm) / 100;
}

function evaluateVitals(pred: any, gold: any): number {
  const fields = ['bp', 'hr', 'temp_f', 'spo2'];
  let totalScore = 0;
  let fieldCount = 0;

  for (const field of fields) {
    fieldCount++;
    const predVal = pred[field];
    const goldVal = gold[field];

    if (predVal === null && goldVal === null) {
      totalScore += 1.0;
    } else if (predVal === null || goldVal === null) {
      totalScore += 0.0;
    } else {
      switch (field) {
        case 'bp':
          // Exact string match after normalization
          const predBp = predVal.replace(/\s+/g, '');
          const goldBp = goldVal.replace(/\s+/g, '');
          totalScore += predBp === goldBp ? 1.0 : 0.0;
          break;
        case 'hr':
        case 'spo2':
          // Exact numeric match
          totalScore += predVal === goldVal ? 1.0 : 0.0;
          break;
        case 'temp_f':
          // Match within ±0.2
          totalScore += Math.abs(predVal - goldVal) <= 0.2 ? 1.0 : 0.0;
          break;
      }
    }
  }

  return totalScore / fieldCount;
}

function evaluateMedications(pred: any[], gold: any[]): number {
  if (gold.length === 0) return pred.length === 0 ? 1.0 : 0.0;

  let totalPrecision = 0;
  let totalRecall = 0;

  // For each gold medication, find best matching predicted medication
  for (const goldMed of gold) {
    let bestMatch = 0;

    for (const predMed of pred) {
      const nameScore = fuzzball.token_set_ratio(
        predMed.name.toLowerCase(),
        goldMed.name.toLowerCase()
      ) / 100;

      if (nameScore >= 0.8) { // Name fuzzy match threshold
        const doseMatch = normalizeString(predMed.dose) === normalizeString(goldMed.dose);
        const freqMatch = normalizeString(predMed.frequency) === normalizeString(goldMed.frequency);
        const routeMatch = normalizeString(predMed.route) === normalizeString(goldMed.route);

        if (doseMatch && freqMatch && routeMatch) {
          bestMatch = Math.max(bestMatch, 1.0);
        }
      }
    }

    totalRecall += bestMatch;
  }

  // For each predicted medication, find best matching gold medication
  for (const predMed of pred) {
    let bestMatch = 0;

    for (const goldMed of gold) {
      const nameScore = fuzzball.token_set_ratio(
        predMed.name.toLowerCase(),
        goldMed.name.toLowerCase()
      ) / 100;

      if (nameScore >= 0.8) {
        const doseMatch = normalizeString(predMed.dose) === normalizeString(goldMed.dose);
        const freqMatch = normalizeString(predMed.frequency) === normalizeString(goldMed.frequency);
        const routeMatch = normalizeString(predMed.route) === normalizeString(goldMed.route);

        if (doseMatch && freqMatch && routeMatch) {
          bestMatch = Math.max(bestMatch, 1.0);
        }
      }
    }

    totalPrecision += bestMatch;
  }

  const precision = pred.length > 0 ? totalPrecision / pred.length : 1.0;
  const recall = gold.length > 0 ? totalRecall / gold.length : 1.0;

  // F1 score
  return precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0.0;
}

function evaluateDiagnoses(pred: any[], gold: any[]): number {
  if (gold.length === 0) return pred.length === 0 ? 1.0 : 0.0;

  let totalPrecision = 0;
  let totalRecall = 0;

  // For each gold diagnosis, find best matching predicted
  for (const goldDiag of gold) {
    let bestMatch = 0;

    for (const predDiag of pred) {
      const descScore = fuzzball.token_set_ratio(
        predDiag.description.toLowerCase(),
        goldDiag.description.toLowerCase()
      ) / 100;

      if (descScore >= 0.7) { // Description fuzzy match threshold
        let score = descScore;
        // Bonus for ICD-10 match
        if (predDiag.icd10 && goldDiag.icd10 && predDiag.icd10 === goldDiag.icd10) {
          score = Math.min(score + 0.1, 1.0);
        }
        bestMatch = Math.max(bestMatch, score);
      }
    }

    totalRecall += bestMatch;
  }

  // For each predicted diagnosis, find best matching gold
  for (const predDiag of pred) {
    let bestMatch = 0;

    for (const goldDiag of gold) {
      const descScore = fuzzball.token_set_ratio(
        predDiag.description.toLowerCase(),
        goldDiag.description.toLowerCase()
      ) / 100;

      if (descScore >= 0.7) {
        let score = descScore;
        if (predDiag.icd10 && goldDiag.icd10 && predDiag.icd10 === goldDiag.icd10) {
          score = Math.min(score + 0.1, 1.0);
        }
        bestMatch = Math.max(bestMatch, score);
      }
    }

    totalPrecision += bestMatch;
  }

  const precision = pred.length > 0 ? totalPrecision / pred.length : 1.0;
  const recall = gold.length > 0 ? totalRecall / gold.length : 1.0;

  return precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0.0;
}

function evaluatePlan(pred: string[], gold: string[]): number {
  if (gold.length === 0) return pred.length === 0 ? 1.0 : 0.0;

  let totalPrecision = 0;
  let totalRecall = 0;

  // Normalize items
  const normalizeItem = (item: string) => item.toLowerCase().trim();

  // For each gold item, find best fuzzy match in predicted
  for (const goldItem of gold) {
    const goldNorm = normalizeItem(goldItem);
    let bestMatch = 0;

    for (const predItem of pred) {
      const predNorm = normalizeItem(predItem);
      const score = fuzzball.token_set_ratio(predNorm, goldNorm) / 100;
      if (score >= 0.7) { // Threshold
        bestMatch = Math.max(bestMatch, score);
      }
    }

    totalRecall += bestMatch;
  }

  // For each predicted item, find best match in gold
  for (const predItem of pred) {
    const predNorm = normalizeItem(predItem);
    let bestMatch = 0;

    for (const goldItem of gold) {
      const goldNorm = normalizeItem(goldItem);
      const score = fuzzball.token_set_ratio(predNorm, goldNorm) / 100;
      if (score >= 0.7) {
        bestMatch = Math.max(bestMatch, score);
      }
    }

    totalPrecision += bestMatch;
  }

  const precision = pred.length > 0 ? totalPrecision / pred.length : 1.0;
  const recall = gold.length > 0 ? totalRecall / gold.length : 1.0;

  return precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0.0;
}

function evaluateFollowUp(pred: any, gold: any): number {
  let intervalScore = 0;
  let reasonScore = 0;

  // interval_days: exact match
  if (pred.interval_days === null && gold.interval_days === null) {
    intervalScore = 1.0;
  } else if (pred.interval_days !== null && gold.interval_days !== null) {
    intervalScore = pred.interval_days === gold.interval_days ? 1.0 : 0.0;
  } else {
    intervalScore = 0.0;
  }

  // reason: fuzzy match
  if (pred.reason === null && gold.reason === null) {
    reasonScore = 1.0;
  } else if (pred.reason !== null && gold.reason !== null) {
    reasonScore = fuzzball.token_set_ratio(
      pred.reason.toLowerCase(),
      gold.reason.toLowerCase()
    ) / 100;
  } else {
    reasonScore = 0.0;
  }

  return (intervalScore + reasonScore) / 2;
}

function detectHallucinations(prediction: ExtractionResult, transcript: string): number {
  const transcriptLower = transcript.toLowerCase();
  let hallucinationCount = 0;

  // Helper to check if a value is hallucinated
  const isHallucinated = (value: string | number | null): boolean => {
    if (value === null) return false;
    const strValue = String(value).toLowerCase();

    // Check substring match
    if (transcriptLower.includes(strValue)) return false;

    // Check fuzzy match against 10-word windows
    const words = transcriptLower.split(/\s+/);
    for (let i = 0; i <= words.length - 10; i++) {
      const window = words.slice(i, i + 10).join(' ');
      const score = fuzzball.token_set_ratio(strValue, window) / 100;
      if (score >= 0.85) return false;
    }

    return true;
  };

  // Check chief complaint
  if (isHallucinated(prediction.chief_complaint)) hallucinationCount++;

  // Check vitals
  if (isHallucinated(prediction.vitals.bp)) hallucinationCount++;
  if (isHallucinated(prediction.vitals.hr)) hallucinationCount++;
  if (isHallucinated(prediction.vitals.temp_f)) hallucinationCount++;
  if (isHallucinated(prediction.vitals.spo2)) hallucinationCount++;

  // Check medications
  for (const med of prediction.medications) {
    if (isHallucinated(med.name)) hallucinationCount++;
    if (isHallucinated(med.dose)) hallucinationCount++;
    if (isHallucinated(med.frequency)) hallucinationCount++;
    if (isHallucinated(med.route)) hallucinationCount++;
  }

  // Check diagnoses
  for (const diag of prediction.diagnoses) {
    if (isHallucinated(diag.description)) hallucinationCount++;
    if (diag.icd10 && isHallucinated(diag.icd10)) hallucinationCount++;
  }

  // Check plan
  for (const item of prediction.plan) {
    if (isHallucinated(item)) hallucinationCount++;
  }

  // Check follow_up
  if (isHallucinated(prediction.follow_up.interval_days)) hallucinationCount++;
  if (isHallucinated(prediction.follow_up.reason)) hallucinationCount++;

  return hallucinationCount;
}

function normalizeString(str: string | null): string {
  if (!str) return '';
  return str.toLowerCase().replace(/[^\w\s]/g, '').trim();
}