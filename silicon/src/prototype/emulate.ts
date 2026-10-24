// A strict JS model of how Figma's prototype engine runs an action list: SET_VARIABLE
// evaluates its VariableData (aliases, literals, nested EXPRESSIONs) against the current
// values, in order; CONDITIONAL runs the first block whose condition holds (or the block
// without a condition). Used by tests to execute the exact objects handed to
// `setReactionsAsync`. It rejects malformed shapes and type mismatches loudly.

export type FigmaValue = boolean | number | string;

export interface EmulatorHooks {
  /** Called for NODE/NAVIGATE actions. */
  navigate?: (destinationId: string | null) => void;
}

const isExpression = (v: unknown): v is Expression =>
  typeof v === "object" && v !== null && "expressionFunction" in v && "expressionArguments" in v;

function typeOf(v: FigmaValue): VariableResolvedDataType {
  return typeof v === "boolean" ? "BOOLEAN" : typeof v === "number" ? "FLOAT" : "STRING";
}

export function evalVariableData(d: VariableData, vars: Map<string, FigmaValue>): FigmaValue {
  if (!d.type || !d.resolvedType) throw new Error(`VariableData without type/resolvedType: ${JSON.stringify(d)}`);
  let out: FigmaValue;
  if (d.type === "VARIABLE_ALIAS") {
    const a = d.value as VariableAlias;
    if (!a || a.type !== "VARIABLE_ALIAS" || typeof a.id !== "string") throw new Error(`bad alias ${JSON.stringify(d)}`);
    const v = vars.get(a.id);
    if (v === undefined) throw new Error(`alias to unknown variable ${a.id}`);
    out = v;
  } else if (d.type === "EXPRESSION") {
    if (!isExpression(d.value)) throw new Error(`EXPRESSION without an Expression value: ${JSON.stringify(d)}`);
    out = evalExpression(d.value, vars);
  } else if (d.type === "BOOLEAN" || d.type === "FLOAT" || d.type === "STRING") {
    const v = d.value;
    if (typeof v !== "boolean" && typeof v !== "number" && typeof v !== "string") throw new Error(`bad literal ${JSON.stringify(d)}`);
    out = v;
    if (typeOf(out) !== d.type) throw new Error(`literal ${JSON.stringify(v)} is not ${d.type}`);
  } else throw new Error(`unsupported VariableData type ${d.type}`);
  if (typeOf(out) !== d.resolvedType) throw new Error(`value ${out} does not resolve to ${d.resolvedType}`);
  return out;
}

function evalExpression(x: Expression, vars: Map<string, FigmaValue>): FigmaValue {
  const args = x.expressionArguments.map((a) => evalVariableData(a, vars));
  const unary = x.expressionFunction === "NOT" || x.expressionFunction === "NEGATE";
  if (args.length !== (unary ? 1 : 2)) throw new Error(`${x.expressionFunction} with ${args.length} arguments`);
  const bools = () => {
    if (args.some((a) => typeof a !== "boolean")) throw new Error(`${x.expressionFunction} needs booleans, got ${args}`);
    return args as boolean[];
  };
  const nums = () => {
    if (args.some((a) => typeof a !== "number")) throw new Error(`${x.expressionFunction} needs numbers, got ${args}`);
    return args as number[];
  };
  switch (x.expressionFunction) {
    case "AND":
      return bools()[0] && bools()[1];
    case "OR":
      return bools()[0] || bools()[1];
    case "NOT":
      return !bools()[0];
    case "EQUALS":
      return args[0] === args[1];
    case "NOT_EQUAL":
      return args[0] !== args[1];
    case "ADDITION":
      if (typeof args[0] === "string" || typeof args[1] === "string") return `${args[0]}${args[1]}`;
      return nums()[0] + nums()[1];
    case "SUBTRACTION":
      return nums()[0] - nums()[1];
    case "MULTIPLICATION":
      return nums()[0] * nums()[1];
    case "DIVISION":
      return nums()[0] / nums()[1];
    case "NEGATE":
      return -nums()[0];
    case "LESS_THAN":
      return nums()[0] < nums()[1];
    case "LESS_THAN_OR_EQUAL":
      return nums()[0] <= nums()[1];
    case "GREATER_THAN":
      return nums()[0] > nums()[1];
    case "GREATER_THAN_OR_EQUAL":
      return nums()[0] >= nums()[1];
    default:
      throw new Error(`unsupported expression function ${x.expressionFunction}`);
  }
}

/** Runs actions in place on `vars` (variable id → value). */
export function runFigmaActions(actions: readonly Action[], vars: Map<string, FigmaValue>, hooks: EmulatorHooks = {}): void {
  for (const a of actions) {
    switch (a.type) {
      case "SET_VARIABLE": {
        if (!a.variableId || !a.variableValue) throw new Error(`SET_VARIABLE without variable/value`);
        const old = vars.get(a.variableId);
        if (old === undefined) throw new Error(`SET_VARIABLE on unknown variable ${a.variableId}`);
        const v = evalVariableData(a.variableValue, vars);
        if (typeOf(v) !== typeOf(old)) throw new Error(`SET_VARIABLE ${a.variableId}: ${typeOf(v)} into ${typeOf(old)}`);
        vars.set(a.variableId, v);
        break;
      }
      case "CONDITIONAL": {
        for (const block of a.conditionalBlocks) {
          if (block.condition) {
            const c = evalVariableData(block.condition, vars);
            if (typeof c !== "boolean") throw new Error(`condition is not boolean`);
            if (!c) continue;
          }
          runFigmaActions(block.actions, vars, hooks);
          break;
        }
        break;
      }
      case "NODE":
        hooks.navigate?.(a.destinationId);
        break;
      default:
        throw new Error(`emulator does not support ${a.type}`);
    }
  }
}
