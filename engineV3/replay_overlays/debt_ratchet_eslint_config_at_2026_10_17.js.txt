import tseslint from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';

// const FUNCTION_VERBS = [
//   'get', 'set', 'find', 'write', 'store', 'create', 'remove', 'modify',
//   'read', 'load', 'save', 'fetch', 'build', 'make', 'compute', 'calculate', 'count',
//   'parse', 'format', 'render', 'draw', 'print', 'log', 'emit', 'send', 'receive',
//   'handle', 'process', 'run', 'execute', 'start', 'stop', 'init', 'open', 'close',
//   'add', 'append', 'insert', 'push', 'pop', 'delete', 'clear', 'reset', 'update',
//   'apply', 'merge', 'split', 'join', 'combine', 'filter', 'sort', 'convert', 'transform',
//   'normalize', 'resolve', 'validate', 'verify', 'check', 'ensure', 'assert', 'match',
//   'compare', 'collect', 'extract', 'scan', 'search', 'list', 'show', 'hide', 'enable',
//   'disable', 'toggle', 'wrap', 'encode', 'decode', 'copy', 'move', 'rename', 'spawn',
//   'launch', 'install', 'register', 'notify', 'dispatch', 'trigger', 'schedule', 'wait',
//   'retry', 'prune', 'trim', 'strip', 'replace', 'pick', 'select', 'prepare', 'produce',
//   'generate', 'detect', 'describe', 'report', 'track', 'record', 'mark', 'measure',
//   'sync', 'refresh', 'fill', 'attach', 'use', 'block', 'allow', 'deny', 'ask',
//   'is', 'has', 'can', 'should', 'contains', 'exists', 'equals',
// ];
const FUNCTION_VERBS = [
  'get', 'read', 'load', 'fetch', 'collect', 'extract', 'open',
  'set', 'write', 'store', 'save', 'fill', 'create', 'update', 'format', 'list', 'emit', 'install', 'copy',
  'generate', 'compute', 'calculate', 'count', 'measure', 'add', 'parse',
  'init', 'apply', 'reset', 'dispatch', 'trigger', 'execute', 'stop', 'launch', 'wait', 'retry', 'enable', 'toggle',
  'select', 'filter', 'wrap', 'sort', 'hide', 'disable', 'block', 'deny',
  'remove', 'clear', 'trim', 'pop', 'append', 'insert', 'push', 'modify', 'replace', 'convert', 'transform', 'normalize', 'encode', 'decode', 'merge', 'join', 'split', 'move',
  'validate', 'contains',
  'match', 'compare', 'is', 'exists', 'equals',
  'find', 'search', 'scan',
  'build', 'schedule', 'close',
  'receive', 'attach', 'rename', 'sync', 'report', 'send', 'notify', 'mark',
  'refresh', 'render', 'print', 'log', 'spawn', 'register', 'assert',
];
// const capitalizedVerbs = [];
// for (const verb of FUNCTION_VERBS)
//   capitalizedVerbs.push(verb[0].toUpperCase() + verb.slice(1));
// // A verb counts as a whole word: start of name, after "_", or a capitalized camelCase word.
// const VERB_WORD = `(^|_)(${FUNCTION_VERBS.join('|')})([A-Z0-9_]|$)|(${capitalizedVerbs.join('|')})([A-Z0-9_]|$)`;
// A name starts with a verb, after an optional "prefix_".
const VERB_WORD = `^([a-z0-9]+_)?(${FUNCTION_VERBS.join('|')})([A-Z0-9_]|$)`;
const FUNCTION_NAME_SELECTOR = [
  `FunctionDeclaration > Identifier.id[name!=/${VERB_WORD}/]`,
  `VariableDeclarator[init.type=/^(ArrowFunctionExpression|FunctionExpression)$/] > Identifier.id[name!=/${VERB_WORD}/]`,
  `MethodDefinition[kind="method"] > Identifier.key[name!=/${VERB_WORD}/]`,
].join(', ');

export default [
  {
    basePath: '/',
    ignores: [
      '**/*.test.ts',
      '**/node_modules/**',
      '**/claude/hooks/fixtures/**',
      '**/dist/**',
      '**/build/**',
    ],
  },
  {
    basePath: '/',
    files: ['**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: {
      '@stylistic': stylistic,
    },
    rules: {
      '@stylistic/brace-style': ['error', 'stroustrup', { allowSingleLine: false }],
      '@stylistic/nonblock-statement-body-position': ['error', 'below'],
      '@stylistic/max-statements-per-line': ['error', { max: 1 }],
      '@stylistic/indent': ['error', 2],
      '@stylistic/no-trailing-spaces': 'error',
      '@stylistic/semi': ['error', 'always'],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.type="MemberExpression"][callee.property.name=/^(map|filter|reduce|forEach|flatMap|some|every|find|findIndex)$/]',
          message: 'Use a for loop that pushes into a named result array.',
        },
        {
          selector: 'IfStatement > .test[type="CallExpression"][callee.type="MemberExpression"][callee.property.name=/^(test|match)$/], IfStatement > .test CallExpression[callee.type="MemberExpression"][callee.property.name=/^(test|match)$/], WhileStatement > .test[type="CallExpression"][callee.type="MemberExpression"][callee.property.name=/^(test|match)$/], WhileStatement > .test CallExpression[callee.type="MemberExpression"][callee.property.name=/^(test|match)$/], ConditionalExpression > .test[type="CallExpression"][callee.type="MemberExpression"][callee.property.name=/^(test|match)$/], ConditionalExpression > .test CallExpression[callee.type="MemberExpression"][callee.property.name=/^(test|match)$/], LogicalExpression CallExpression[callee.type="MemberExpression"][callee.property.name=/^(test|match)$/]',
          message: 'Name the regex as a const and the result as a boolean before the condition.',
        },
        {
          selector: 'CallExpression > .arguments[type=/^(ArrowFunctionExpression|FunctionExpression)$/] LogicalExpression[operator=/^(&&|\\|\\|)$/], IfStatement > .test[type="LogicalExpression"][operator=/^(&&|\\|\\|)$/], IfStatement > .test LogicalExpression[operator=/^(&&|\\|\\|)$/], WhileStatement > .test[type="LogicalExpression"][operator=/^(&&|\\|\\|)$/], WhileStatement > .test LogicalExpression[operator=/^(&&|\\|\\|)$/]',
          message: 'One named boolean per side; combine them on their own line.',
        },
        {
          selector: 'IfStatement > .test[type="CallExpression"], IfStatement > .test CallExpression',
          message: 'Assign the call result to a named const before the if.',
        },
        {
          selector: 'CallExpression[callee.type="MemberExpression"][callee.object.type="CallExpression"][callee.object.callee.type="MemberExpression"][callee.object.callee.object.type="CallExpression"]',
          message: 'Break the chain: one call per line into a named variable.',
        },
        {
          selector: FUNCTION_NAME_SELECTOR,
          message: 'Function names need a verb from FUNCTION_VERBS in the eslint.config.js of the debt-ratchet folder.',
        },
        {
          selector: 'CallExpression > .arguments[type=/^(ArrowFunctionExpression|FunctionExpression)$/]',
          message: 'Pass a named function, not an inline one.',
        },
      ],
    },
  },
];
