export { zod4Resolver as zodResolver } from 'mantine-form-zod-resolver';

/**
 * Identifier-safe string: starts with a letter or underscore, followed by
 * letters, digits, or underscores -- the shape of a valid variable name,
 * slug, asset tag, etc.
 */
export const identifierRegex = /^[A-Za-z_][A-Za-z0-9_]*$/;
