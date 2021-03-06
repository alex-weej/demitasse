let output = (...args: any[]) => console.log(...args);
let logout = (...args: any[]) => console.error(...args);
let reporter: () => Reporter = () => new TAPReporter();
let autorun = true;
let itemtimeout = 2500;
let print = false;
let summary = false;

let success = true;

class Cancelable<T> extends Promise<T> {
  cancel() {}
}

export interface asserter {
  (): Promise<void> | void;
}
export interface describer {
  (): void;
}
let sleep = (ms: number): Cancelable<void> => {
  const later: {
    promise?: Cancelable<void>;
    resolve?: () => void;
    timer?: any;
    cancel?: () => void;
  } = {};
  later.promise = new Promise((resolve) => {
    later.resolve = resolve;
  }) as Cancelable<void>;
  later.timer = setTimeout(() => {
    later.timer = null;
    later.resolve && later.resolve();
  }, ms);
  later.timer.unref();
  later.cancel = () => {
    later.timer && clearTimeout(later.timer);
    later.timer = null;
    later.resolve && later.resolve();
  };
  later.promise.cancel = later.cancel;
  return later.promise;
};
export class AssertionError extends Error {
  code?: string;
  actual?: any;
  expected?: any;
}

export interface Walker {
  enter(item: TestSuite): void;
  case(item: TestCase): void;
  exit(item: TestSuite): void;
}
export interface Reporter extends Walker {
  bailed: boolean;
  report(item: TestCase, status: 'ok' | 'not ok' | 'skipped', error?: AssertionError): void;
}
export class TAPReporter implements Reporter {
  constructor() {
    this.indent = '';
    output('TAP version 13');
  }
  private stack: { item: TestCase; items: TestCase[]; count: number }[] = [];
  private summary = { passed: 0, failed: 0, skipped: 0 };
  public bailed: boolean = false;
  private indent: string = '';
  case(item: TestCase) {}
  report(item: TestCase, status: 'ok' | 'not ok' | 'skipped', error?: AssertionError) {
    const indent = this.indent + new Array(Math.max(0, this.stack.length - 1)).fill('  ').join('');
    if (!this.bailed && this.stack.length && !!~this.stack[0].items.indexOf(item)) {
      switch (status) {
        case 'ok':
          this.summary.passed += 1;
          break;
        case 'not ok':
          this.summary.failed += 1;
          break;
        case 'skipped':
          this.summary.skipped += 1;
          break;
      }
      const cur = this.stack[0];
      cur.count += 1;
      output(
        `${indent}${status === 'skipped' ? 'ok' : status} ${cur.count} - ${item.label}${
          status === 'skipped' ? ' #skip' : ''
        }${error && error.code === 'ERR_TIMEOUT' ? ' #timeout' : ''}`
      );
    }
    if (error) {
      switch (true) {
        case error.code === 'ERR_TIMEOUT':
          break;
        case error.code === 'ERR_ASSERTION': {
          output(`${indent}  ---`);
          output(`${indent}  message: ${error.message}`);
          output(`${indent}  expected: ${JSON.stringify(error.expected)}`);
          output(`${indent}  actual: ${JSON.stringify(error.actual)}`);
          output(`${indent}  ...`);
          break;
        }
        case !!error.stack: {
          for (const line of (error.stack || '').split(/\r?\n/).slice(0, 4)) {
            if (/^\s+at\s+TestCase.execute\s+\(\S+?index.js\:\d+:\d+\)$/.test(line)) break;
            output(`${indent}# ${line}`);
          }
          break;
        }
        default: {
          output(`${indent}  ---`);
          for (const prop of Object.keys(error)) {
            //@ts-ignore
            output(`${indent}  ${prop}: ${JSON.stringify(error[prop])}`);
          }
          output(`${indent}  ...`);
        }
      }
    }
  }
  enter(item: TestSuite) {
    const items = Array.from(item);
    let indent = this.indent + new Array(Math.max(0, this.stack.length - 1)).fill('  ').join('');
    output(`${indent}# ${item.label}`);
    this.stack.unshift({ item, count: 0, items });
    indent = this.indent + new Array(this.stack.length - 1).fill('  ').join('');
    output(`${indent}1..${items.length}`);
  }
  exit(item: TestSuite) {
    if (this.stack[0].item !== item)
      throw new Error(`invalid invokation. non matching item "${item.label}" !== "${this.stack[0].item.label}"`);
    this.stack.shift();
    if (!this.stack.length) {
      if (this.bailed) {
        output('Bail Out!');
        if ('undefined' !== typeof process) {
          process.exit(3);
        } else {
          throw new Error('Bail Out!');
        }
      }
      if (summary && !this.indent.length) {
        const total = this.summary.passed + this.summary.failed + this.summary.skipped;
        output(`# Tests: ${total}`);
        output(`# Skipped: ${this.summary.skipped}`);
        output(`# Passed: ${this.summary.passed}`);
        output(`# Failed: ${this.summary.failed}`);
      }
    }
  }
}
class TestCase {
  constructor(label: string, runner: asserter) {
    this.label = label;
    this.run = runner;
    this.skipped = false;
    this.timeout = itemtimeout;
  }
  public label: string;
  private readonly run: asserter;
  public skipped: boolean = false;
  public timeout: number;
  async execute(context: Reporter) {
    if (context.bailed) return false;
    if (this.skipped) {
      context.report(this, 'skipped');
      return true;
    }
    try {
      const timer = sleep(this.timeout);
      await Promise.race([
        this.run(),
        timer.then(() => {
          const error = new Error('TIMEOUT');
          //@ts-ignore
          error.code = 'ERR_TIMEOUT';
          throw error;
        })
      ]);
      timer.cancel();
    } catch (error) {
      context.report(this, 'not ok', error);
      return false;
    }
    context.report(this, 'ok');
    return true;
  }
  propagateSkip(skipped: boolean) {
    this.skipped = this.skipped || skipped;
  }
  print(indent = '') {
    output(`${indent}${this.label} ${this.skipped ? ' # skip' : ' # run'}`);
  }
}
class TestSuite extends TestCase {
  constructor(label: string) {
    super(label, async () => {});
  }
  private _before: TestCase[] = [];
  private _beforeEach: TestCase[] = [];
  private _test: TestCase[] = [];
  private _afterEach: TestCase[] = [];
  private _after: TestCase[] = [];
  private _only: TestCase | null = null;
  before(item: TestCase) {
    this._before.push(item);
  }
  beforeEach(item: TestCase) {
    this._beforeEach.push(item);
  }
  test(item: TestCase) {
    this._test.push(item);
    item.skipped = item.skipped || !!(this._only && this._only !== item);
  }
  afterEach(item: TestCase) {
    this._afterEach.push(item);
  }
  after(item: TestCase) {
    this._after.push(item);
  }

  only(item: TestCase) {
    if (this._only) throw new Error(`invalid invocation: only already used for "${this._only.label}"`);
    if (!this._test.includes(item)) throw new Error(`invalid invocation: only not added "${item.label}"`);
    this._only = item;
    for (let item of this._test) {
      item.skipped = item.skipped || !!(this._only && this._only !== item);
    }
  }
  propagateSkip(skipped: boolean) {
    this.skipped = this.skipped || skipped;
    for (const item of this._test) {
      item.propagateSkip(this.skipped);
    }
  }
  async executeList(context: Reporter, list: TestCase[]) {
    for (let item of list) {
      if (!(await item.execute(context))) {
        return false;
      }
    }
    return true;
  }
  async execute(context: Reporter) {
    if (context.bailed) return false;

    let state = true;
    context.enter(this);

    if (!this.skipped && !(await this.executeList(context, this._before))) {
      context.bailed = true;
      state = false;
    }

    if (!context.bailed) {
      for (let item of this._test) {
        if (!item.skipped && !(await this.executeList(context, this._beforeEach))) {
          context.bailed = true;
          continue;
        }
        if (!(await item.execute(context))) {
          state = false;
        }
        if (!item.skipped && !(await this.executeList(context, this._afterEach))) {
          context.bailed = true;
          continue;
        }
      }
    }

    if (!this.skipped && !context.bailed) {
      if (!(await this.executeList(context, this._after))) {
        context.bailed = true;
        state = false;
      }
    }

    context.exit(this);
    if (this.skipped) {
      context.report(this, 'skipped');
      return true;
    } else {
      context.report(this, state ? 'ok' : 'not ok');
      return state;
    }
  }
  print(indent = '') {
    output(`${indent}${this.label} ${this.skipped ? ' # skip' : ' # run'}`);
    for (let item of this._test) {
      item.print(`${indent}  `);
    }
  }

  [Symbol.iterator]() {
    return this._test[Symbol.iterator]();
  }
}

const root: TestSuite[] = [];
let stack: TestSuite[] | null = null;

export interface ConfigOptions {
  autorun?: boolean;
  output?: (args: any[]) => void;
  logout?: (args: any[]) => void;
  reporter?: () => Reporter;
  timeout?: number;
  print?: boolean;
  summary?: boolean;
  sleep?: (ms: number) => Cancelable<void>;
}
export function configure(options: ConfigOptions = {}) {
  autorun = options.autorun !== undefined ? !!options.autorun : autorun;
  output = options.output !== undefined ? options.output : output;
  logout = options.logout !== undefined ? options.logout : logout;
  reporter = options.reporter !== undefined ? options.reporter : reporter;
  itemtimeout = options.timeout !== undefined ? options.timeout : itemtimeout;
  print = options.print !== undefined ? !!options.print : print;
  summary = options.summary !== undefined ? !!options.summary : summary;
  sleep = options.sleep !== undefined ? options.sleep : sleep;
}

export function describe(label: string, runner: describer) {
  if (autorun && stack && !stack.length) throw new Error('only 1 top-level describe allowed');
  const item = new TestSuite(label);
  if (!stack || !stack.length) root.push(item);
  stack = stack || [];
  const cur = stack[0];
  cur && cur.test(item);
  stack.unshift(item);
  runner();
  stack.shift();
  if (autorun && !stack.length) {
    item.propagateSkip(false);
    if (print) {
      item.print();
    } else {
      const context = reporter();
      item
        .execute(context)
        .then((result) => {
          success = !!(!context.bailed && success && result);
        })
        .catch((error) => {
          logout(error.stack);
        });
    }
  }
  const result = {
    skip: () => ((item.skipped = true), result),
    todo: () => ((item.skipped = true), (item.label += ' # todo'), result),
    only: () => (cur && cur.only(item), result)
  };
  return result;
}
describe.skip = (label: string, runner: describer) => describe(label, runner).skip();
describe.todo = (label: string, runner: describer) => describe(`${label} # todo`, runner).skip();
describe.only = (label: string, runner: describer) => describe(label, runner).only();

export function before(runner: asserter) {
  if (!stack || !stack.length) throw new TypeError('invalid invokation. missing context');
  stack[0].before(new TestCase('before', runner));
}
export function beforeEach(runner: asserter) {
  if (!stack || !stack.length) throw new TypeError('invalid invokation. missing context');
  stack[0].beforeEach(new TestCase('beforeEach', runner));
}
export function it(label: string, runner: asserter) {
  const cur = stack && stack[0];
  if (!cur) throw new TypeError('invalid invokation. missing context');
  const item = new TestCase(label, runner);
  cur.test(item);
  const result = {
    skip: () => ((item.skipped = true), result),
    todo: () => ((item.skipped = true), (item.label += ' # todo'), result),
    only: () => (cur.only(item), result),
    timeout: (ms: number) => ((item.timeout = ms), result)
  };
  return result;
}
it.skip = (label: string, runner: asserter) => it(label, runner).skip();
it.todo = (label: string, runner: asserter) => it(`${label} # todo`, runner).skip();
it.only = (label: string, runner: asserter) => it(label, runner).only();
export const timeout = (it.timeout = (label: string, ms: number, runner: asserter) => it(label, runner).timeout(ms));

export function afterEach(runner: asserter) {
  if (!stack || !stack.length) throw new TypeError('invalid invokation. missing context');
  stack[0].afterEach(new TestCase('afterEach', runner));
}
export function after(runner: asserter) {
  if (!stack || !stack.length) throw new TypeError('invalid invokation. missing context');
  stack[0].after(new TestCase('after', runner));
}

export function main() {
  if (autorun) throw new Error('this test is meant to autorun');
  if (!root.length) throw new Error('no tests defined');
  const suite = new TestSuite('');
  root.forEach((item) => suite.test(item));
  const context = reporter();
  suite.propagateSkip(false);
  return suite
    .execute(context)
    .then((result) => {
      return (success = !!(!context.bailed && success && result));
    })
    .catch((error) => {
      logout(error.stack);
      return false;
    });
}

export function skeleton(walker: Walker, items: TestCase[] = root) {
  for (let item of items) {
    if (item instanceof TestSuite) {
      walker.enter(item);
      skeleton(walker, Array.from(item));
      walker.exit(item);
    } else {
      walker.case(item);
    }
  }
}

if ('undefined' !== typeof process) process.on('beforeExit', () => process.exit(success ? 0 : 1));
