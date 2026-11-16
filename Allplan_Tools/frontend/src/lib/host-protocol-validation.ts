/** Offline preparation only. Never imported by the active host bridge. */
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import schema from "../../docs/integration/protocol/2.0.0-rc.1/schema.json";

const ajv = new Ajv2020({ strict: true, strictTypes: false, strictRequired: false, allErrors: true, coerceTypes: false, removeAdditional: false, useDefaults: false });
addFormats(ajv);
ajv.addSchema(schema);
const validators = new Map<string, ReturnType<typeof ajv.compile>>();
export function validateDefinition(target: string, value: unknown): { ok: true } | { ok: false; reason: string } {
  if (target !== "root" && !Object.hasOwn(schema.$defs, target)) return { ok: false, reason: "Unknown schema definition" };
  let validator = validators.get(target);
  if (!validator) {
    validator = ajv.compile({ $ref: target === "root" ? schema.$id : `${schema.$id}#/$defs/${target}` });
    validators.set(target, validator);
  }
  return validator(value) ? { ok: true } : { ok: false, reason: ajv.errorsText(validator.errors) };
}