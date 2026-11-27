import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/**
 * Password policy from the project spec: 8-72 chars with at least one lowercase,
 * uppercase, digit and symbol. Mirrors newPassword in server/src/routes/auth.js.
 */
const RULES: ReadonlyArray<readonly [string, (value: string) => boolean]> = [
  ['min', (v) => v.length >= 8 && v.length <= 72],
  ['lower', (v) => /[a-z]/.test(v)],
  ['upper', (v) => /[A-Z]/.test(v)],
  ['number', (v) => /\d/.test(v)],
  ['special', (v) => /[^A-Za-z0-9]/.test(v)],
];

export function passwordStrength(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value as string;
    if (!value) return null;
    const failed = RULES.filter(([, passes]) => !passes(value)).map(([name]) => name);
    return failed.length > 0 ? { passwordStrength: failed } : null;
  };
}

/** i18n key under "password_rules" for the first rule the value breaks. */
export function passwordRuleErrorKey(control: AbstractControl): string {
  const failed = control.getError('passwordStrength') as string[] | undefined;
  return failed?.length ? `password_rules.${failed[0]}` : 'password_rules.min';
}
