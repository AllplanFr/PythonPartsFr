import allplanObjects from "./allplan-objects.json";
import allplanAttrs from "./allplan-attributes.json";
// Invented Allplan reference data. Will later be supplied by the PythonPart.
export const OPERATORS = ["_IF_(", "_ELSE_(", "_ELSE_IF_(", "|", "&", "!", "=", "<", "<=", ">", ">=", "<>"];

// From Allplan help "Formulas, arithmetic functions and operators" (10058_1). Format: "SYNTAX|description".
export const FUNCTION_GROUPS: { name: string; items: string[] }[] = [
  { name: "General Mathematics", items: ["ABS(X)|Absolute value", "SQRT(X)|Square root", "SQR(X)|Square", "PI(X)|Circle function of pi", "LN(X)|Natural logarithm", "LOG(X)|Logarithm base 10", "RCP(X)|Reciprocal 1/x", "EXP(X)|Exponential function", "SGN(X)|Sign", "NINT(X)|Round to nearest integer", "INT(X)|Round down", "CEIL(X)|Round up", "ROUND(X;x)|Round to x digits", "ROUND(X;y;z)|Round to y digits with precision z"] },
  { name: "Trigonometry", items: ["SIN(X)|Sine", "COS(X)|Cosine", "TAN(X)|Tangent", "ASIN(X)|Arc sine", "ACOS(X)|Arc cosine", "ATAN(X)|Arc tangent", "SINH(X)|Hyperbolic sine", "COSH(X)|Hyperbolic cosine", "TANH(X)|Hyperbolic tangent"] },
  { name: "Units and Angle Conversion", items: ["GRA(X)|Radians to degrees", "RAD(X)|Degrees to radians", "GON(X)|Radians to grads", "RAG(X)|Grads to radians"] },
  { name: "Statistics", items: ["AVG(x1;x2)|Average of up to 10 arguments", "MIN(x1;x2)|Minimum of up to 10 arguments", "MAX(x1;x2)|Maximum of up to 10 arguments"] },
  { name: "Data and Text Analysis", items: ["VALUE(string;index)|Derive values from text", "MID(Text;First;Count)|Part of a character string", "FORMAT(format;value1)|Formatted output of values"] },
  { name: "Other", items: ["FLAG(Value;bit)|Binary check", "ELE(attr;v1;v2)|Filter numeric values, returns 0 or 1"] },
  { name: "PRECAST", items: ["PARENTPRECAST()|Attributes of the parent precast element"] },
];

/** Allplan object numbers and names (from objekt.000) until the PythonPart supplies them. */
export const OBJECTS: { code: number; name: string }[] = allplanObjects;

export const FINISH_TYPES = [
  { id: "floor", name: "Floor" }, { id: "baseboard", name: "Baseboard" }, { id: "wall", name: "Vertical wall" },
  { id: "ceiling", name: "Ceiling" }, { id: "additional", name: "Additional materials" },
];
export const FINISH_INFOS = ["Height", "Area", "Length", "Thickness", "Material", "Volume"];

/** Trades = enumeration of attribute 209 (index = value). */
export const TRADES: { code: string; value: number }[] = (allplanAttrs.attributes.find((a) => a.num === 209)?.options ?? [])
  .map((code, value) => ({ code: code.trim(), value })).filter((x) => x.code);
