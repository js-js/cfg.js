var ssa = require('../ssa');
var Graph = ssa.Graph;

var assert = require('assert');

function Deconstructor(ssa, options) {
  this.ssa = new Graph(ssa).construct();
  this.options = options || {};

  this.prefix = this.options.prefix || {};

  // Shared instruction prefix
  this.prefix.instruction = this.prefix.instruction || '__$ssa_i_';

  // Context variable prefix
  this.prefix.context = this.prefix.context || '__$ssa_c_';

  // Current body
  this.currentBody = null;
  this.currentBlock = null;
  this.currentIndex = null;
}
module.exports = Deconstructor;

Deconstructor.prototype.deconstruct = function deconstruct() {
  var out = { type: 'Program', body: [] };
  this.currentBody = out.body;

  if (this.ssa.length === 0)
    return out;

  this.visitBlock(this.ssa[0]);

  return out;
};

Deconstructor.prototype.visitBlock = function visitBlock(block) {
  var oldBlock = this.currentBlock;
  this.currentBlock = block;

  // Walk through instructions in a reverse order
  for (var i = block.instructions.length - 1; i >= 0; i--) {
    this.currentIndex = i;
    this.visitStatement(block.instructions[i]);
  }

  this.currentBlock = oldBlock;
};

Deconstructor.prototype.visitStatement = function visitStatement(instr) {
  // Skip already inserted instructions
  if (instr.inserted)
    return;

  var expr = this.visitExpression(instr);
  instr.inserted = true;

  var res;
  if (instr.uses.length !== 0) {
    res = {
      type: 'VariableDeclaration',
      kind: 'var',
      declarations: [
        {
          type: 'VariableDeclarator',
          id: this.instrId(instr.id),
          init: expr
        }
      ]
    };
  } else if (/(Statement|Declaration)$/.test(expr.type)) {
    res = expr;
  } else {
    res = {
      type: 'ExpressionStatement',
      expression: expr
    };
  }
  this.add(res);
};

Deconstructor.prototype.visitExpression = function visitExpression(instr) {
  var res;
  if (instr.type === 'ret')
    res = this.visitRet(instr);
  else if (instr.type === 'literal')
    res = this.visitLiteral(instr);
  else if (instr.type === 'variable')
    res = this.visitVariable(instr);
  else if (instr.type === 'binary')
    res = this.visitBinary(instr);
  else if (instr.type === 'call')
    res = this.visitCall(instr);
  else if (instr.type === 'loadGlobal')
    res = this.visitLoadGlobal(instr);
  else if (instr.type === 'storeGlobal')
    res = this.visitStoreGlobal(instr);
  else if (instr.type === 'loadProperty')
    res = this.visitLoadProperty(instr);
  else if (instr.type === 'storeProperty')
    res = this.visitStoreProperty(instr);
  else if (instr.type === 'branch')
    res = this.visitBranch(instr);
  else
    throw new Error('Unknown instruction type: ' + instr.type);

  if (instr.assign) {
    res = {
      type: 'AssignmentExpression',
      operator: '=',
      left: { type: 'Identifier', name: instr.assignName || instr.id },
      right: res
    };
  }

  return res;
};

Deconstructor.prototype.visitSubExpr = function visitSubExpr(instr) {
  // TODO(indutny): handle `a = b = c`
  // TODO(indutny): this should be aware of side-effects
  // Input has multiple uses, can't be embedded
  // NOTE: literal's could always be embedded
  if (instr.uses.length > 1 && instr.type !== 'literal')
    return this.instrId(instr.id);

  instr.inserted = true;
  return this.visitExpression(instr);
};

Deconstructor.prototype.visitRet = function visitRet(instr) {
  assert.equal(instr.uses.length, 0, 'Return has no output');
  assert.equal(instr.inputs.length, 1, 'Return has != 1 inputs');

  var input = this.visitSubExpr(instr.inputs[0]);

  if (this.options.global === false) {
    return {
      type: 'ReturnStatement',
      argument: input
    };
  } else {
    return input;
  }
};

Deconstructor.prototype.visitLiteral = function visitLiteral(instr) {
  assert.equal(instr.inputs.length, 1, 'Literal has != 1 inputs');
  assert.equal(instr.inputs[0].type, 'js', 'Literal has non-js input');

  if (instr.inputs[0].id === undefined)
    return { type: 'Identifier', name: 'undefined' };

  return { type: 'Literal', value: instr.inputs[0].id };
};

Deconstructor.prototype.visitBinary = function visitBinary(instr) {
  assert.equal(instr.inputs.length, 3, 'Binary has != 3 inputs');
  assert.equal(instr.inputs[0].type, 'js', 'Binary has non-js operator');

  return {
    type: 'BinaryExpression',
    operator: instr.inputs[0].id,
    left: this.visitSubExpr(instr.inputs[1]),
    right: this.visitSubExpr(instr.inputs[2])
  };
};

Deconstructor.prototype.visitCall = function visitCall(instr) {
  assert.equal(instr.inputs.length, 3, 'Call has != 3 inputs');
  assert.equal(instr.inputs[2].type, 'js', 'Call has non-js argc');

  // Collect arguments
  var collected = 0;
  var argc = instr.inputs[2].id;
  var argv = [];
  this.iterateBack(function(instr) {
    if (instr.type !== 'pushArg')
      return true;

    argv.push(instr);
    instr.inserted = true;
    return ++collected <= argc;
  });
  assert.equal(collected, argc, 'Not enough pushArg instructions for a call');

  // Map each argument to expression
  argv = argv.map(function(arg) {
    assert.equal(arg.inputs.length, 1);
    return this.visitSubExpr(arg.inputs[0]);
  }, this);

  if (instr.inputs[0].type === 'loadProperty' &&
      instr.inputs[0].inputs[0] === instr.inputs[1]) {
    instr.inputs[1].removeUse(instr);

    // a.b()
    return {
      type: 'CallExpression',
      callee: this.visitSubExpr(instr.inputs[0]),
      arguments: argv
    };
  }

  var fn = this.visitSubExpr(instr.inputs[0]);
  if (instr.inputs[1].type === 'global') {
    instr.inputs[1].inserted = true;
    // a()
    return {
      type: 'CallExpression',
      callee: fn,
      arguments: argv
    };
  } else {
    // a.call(self, argv);
    var self = this.visitSubExpr(instr.inputs[1]);
    return {
      type: 'CallExpression',
      callee: {
        type: 'MemberExpression',
        computed: false,
        object: fn,
        property: { type: 'Identifier', name: 'call' }
      },
      arguments: [ self ].concat(argv)
    };
  }
};

Deconstructor.prototype.visitLoadGlobal = function visitLoadGlobal(instr) {
  assert.equal(instr.inputs.length, 1, 'loadGlobal has != 1 arguments');
  assert.equal(instr.inputs[0].type, 'js', 'loadGlobal has non-js argument');

  return {
    type: 'Identifier',
    name: instr.inputs[0].id
  };
};

Deconstructor.prototype.visitStoreGlobal = function visitStoreGlobal(instr) {
  assert.equal(instr.inputs.length, 2, 'storeGlobal has != 2 arguments');
  assert.equal(instr.inputs[0].type, 'js', 'storeGlobal has non-js argument');

  return {
    type: 'AssignmentExpression',
    operator: '=',
    left: { type: 'Identifier', name: instr.inputs[0].id },
    right: this.visitSubExpr(instr.inputs[1])
  };
};

Deconstructor.prototype.memberExpr = function memberExpr(object, property) {
  if (property.type === 'Literal' &&
      typeof property.value === 'string' &&
      /^[a-z$_]$/i.test(property.value)) {
    return {
      type: 'MemberExpression',
      computed: false,
      object: object,
      property: { type: 'Identifier', name: property.value }
    };
  }

  return {
    type: 'MemberExpression',
    computed: true,
    object: object,
    property: property
  };
};

Deconstructor.prototype.visitLoadProperty = function visitLoadProperty(instr) {
  assert.equal(instr.inputs.length, 2, 'loadProperty has != 2 arguments');
  var property = this.visitSubExpr(instr.inputs[1]);
  var object = this.visitSubExpr(instr.inputs[0]);

  return this.memberExpr(object, property);
};

Deconstructor.prototype.visitStoreProperty =
    function visitStoreProperty(instr) {
  assert.equal(instr.inputs.length, 3, 'storeProperty has != 3 arguments');
  var value = this.visitSubExpr(instr.inputs[2]);
  var property = this.visitSubExpr(instr.inputs[1]);
  var object = this.visitSubExpr(instr.inputs[0]);

  return {
    type: 'AssignmentExpression',
    operator: '=',
    left: this.memberExpr(object, property),
    right: value
  };
};

Deconstructor.prototype.visitBranch = function visitBranch(instr) {
  return { type: 'EmptyStatement' };
};

Deconstructor.prototype.visitVariable = function visitVariable(instr) {
  return { type: 'Identifier', name: instr.id }
};

Deconstructor.prototype.add = function add(ast) {
  this.currentBody.unshift(ast);
};

Deconstructor.prototype.instrId = function instrId(id) {
  return { type: 'Identifier', name: this.prefix.instruction + id };
};

Deconstructor.prototype.iterateBack = function iterateBack(cb) {
  var block = this.currentBlock;
  var index = this.currentIndex;

  while (block !== null) {
    for (var i = index; i >= 0; i--)
      if (!cb.call(this, block.instructions[i]))
        return;

    block = block.parent;
    if (block !== null)
      index = block.instructions.length - 1;
  }
};
