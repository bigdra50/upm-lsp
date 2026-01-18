/**
 * Result type for explicit error handling
 *
 * Provides a functional approach to error handling without exceptions.
 * Inspired by Rust's Result and fp-ts Either.
 */

/**
 * Result type - either success (Ok) or failure (Err)
 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/**
 * Create a successful Result
 */
export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

/**
 * Create a failed Result
 */
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/**
 * Check if Result is Ok
 */
export const isOk = <T, E>(result: Result<T, E>): result is { ok: true; value: T } =>
  result.ok;

/**
 * Check if Result is Err
 */
export const isErr = <T, E>(result: Result<T, E>): result is { ok: false; error: E } =>
  !result.ok;

/**
 * Map over the value if Ok, pass through if Err
 */
export const map = <T, U, E>(
  result: Result<T, E>,
  f: (value: T) => U
): Result<U, E> =>
  result.ok ? ok(f(result.value)) : result;

/**
 * FlatMap (chain) - map and flatten nested Results
 */
export const flatMap = <T, U, E>(
  result: Result<T, E>,
  f: (value: T) => Result<U, E>
): Result<U, E> =>
  result.ok ? f(result.value) : result;

/**
 * Map over the error if Err, pass through if Ok
 */
export const mapError = <T, E, F>(
  result: Result<T, E>,
  f: (error: E) => F
): Result<T, F> =>
  result.ok ? result : err(f(result.error));

/**
 * Get the value or a default
 */
export const getOrElse = <T, E>(
  result: Result<T, E>,
  defaultValue: T
): T =>
  result.ok ? result.value : defaultValue;

/**
 * Get the value or compute a default from the error
 */
export const getOrElseWith = <T, E>(
  result: Result<T, E>,
  f: (error: E) => T
): T =>
  result.ok ? result.value : f(result.error);

/**
 * Convert nullable to Result
 */
export const fromNullable = <T, E>(
  value: T | null | undefined,
  error: E
): Result<T, E> =>
  value != null ? ok(value) : err(error);

/**
 * Try a function that might throw, return Result
 */
export const tryCatch = <T, E>(
  f: () => T,
  onError: (e: unknown) => E
): Result<T, E> => {
  try {
    return ok(f());
  } catch (e) {
    return err(onError(e));
  }
};

/**
 * Try an async function that might throw, return Result
 */
export const tryCatchAsync = async <T, E>(
  f: () => Promise<T>,
  onError: (e: unknown) => E
): Promise<Result<T, E>> => {
  try {
    return ok(await f());
  } catch (e) {
    return err(onError(e));
  }
};

/**
 * Combine multiple Results - if all Ok, return Ok with array of values
 */
export const all = <T, E>(results: readonly Result<T, E>[]): Result<T[], E> => {
  const values: T[] = [];
  for (const result of results) {
    if (!result.ok) return result;
    values.push(result.value);
  }
  return ok(values);
};

/**
 * Match on Result - execute appropriate function based on Ok/Err
 */
export const match = <T, E, U>(
  result: Result<T, E>,
  onOk: (value: T) => U,
  onErr: (error: E) => U
): U =>
  result.ok ? onOk(result.value) : onErr(result.error);
