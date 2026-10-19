import _Ajv from 'ajv';
import _addFormats from 'ajv-formats';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to schema/analysis.v1.schema.json
const schemaPath = path.resolve(__dirname, '../../../schema/analysis.v1.schema.json');
const rawSchema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));

const AjvClass: any = (_Ajv as any).default || _Ajv;
const addFormatsFn: any = (_addFormats as any).default || _addFormats;

const ajv = new AjvClass({ allErrors: true });
addFormatsFn(ajv);

export const validateAnalysisJson = ajv.compile(rawSchema);

export function getValidationErrors(): string {
  if (!validateAnalysisJson.errors) return '';
  return validateAnalysisJson.errors
    .map((err: any) => `${err.instancePath || '/'}: ${err.message}`)
    .join('; ');
}
