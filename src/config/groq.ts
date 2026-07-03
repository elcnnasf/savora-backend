import Groq from 'groq-sdk';
import { env } from './env';

export const groq = new Groq({ apiKey: env.groq.apiKey });

export const GROQ_MODEL         = 'llama-3.3-70b-versatile';
export const GROQ_FALLBACK_MODEL = 'llama-3.1-8b-instant'; // 500k TPD — kicks in when 70b hits daily limit
