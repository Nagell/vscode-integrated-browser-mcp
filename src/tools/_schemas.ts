import { z } from 'zod';

export const pageIdSchema = z.string().describe('Page ID from open_browser_page');
export const refSchema = z.string().optional().describe('Element ref from snapshot (e.g. "e6")');
export const selectorSchema = z.string().optional().describe('Playwright selector');
export const elementSchema = z.string().describe('Human-readable element description (e.g. "submit button")');
