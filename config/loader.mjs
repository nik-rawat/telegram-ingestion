import { resolve as importResolve } from '@node-loader/import';

export async function resolve(specifier, context, nextResolve) {
  // Handle @google/genai specifically
  if (specifier.includes('@google/genai')) {
    return importResolve(specifier, context, nextResolve);
  }
  
  return nextResolve(specifier);
}