export type { FormComponentProps, FormStyle } from './types';
export { identifierRegex, zodResolver } from './validation';
export { FormContainer } from './FormContainer';
export type { FormContainerProps } from './FormContainer';
export { useModalForm } from './useModalForm';
export type { UseModalFormOptions } from './useModalForm';
export { useModalFormSubmit } from './useModalFormSubmit';
export type { UseModalFormSubmitOptions } from './useModalFormSubmit';

// Re-export the rest of @mantine/form (useForm, UseFormReturnType, etc).
export * from '@mantine/form';
