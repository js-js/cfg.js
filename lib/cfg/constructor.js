var assert = require('assert');

function CFG(ast, options, parent) {
  this.blockId = 0;
  this.valueId = 0;
  this.astId = 0;
  this.options = options || {};
  this.parent = parent || null;
  this.root = this.parent || this;

  this.currentAstId = 0;
  this.currentAst = null;
  this.ast = ast;
  this.scope = {};
  this.blocks = [];
  this.children = this.root.children || [];
  this.block = this.createBlock(ast);
  this.contextSize = 0;
  this.loop = null;
  this.initialized = false;

  this.lastExpr = null;

  if (this.parent)
    this.parent.children.push(this);
}
module.exports = CFG;

CFG.construct = function construct(ast, options) {
  return new CFG(ast, options).construct();
};

CFG.prototype.construct = function construct() {
  var ast = this.ast;

  // Resolve local variables
  this.buildScope(ast);

  // Initialize local variables
  this.initializeLocals();

  // Build CFG
  this.visit(ast);

  // Replace context/local stores/loads
  this.replaceVarAccess();

  if (!this.block.ended) {
    // Return the last instruction, if the code is top-level
    if (ast.type === 'Program' && this.lastExpr !== null) {
      this.currentAstId = this.lastExpr.astId;
      this.add('ret', [ this.lastExpr ]);
      this.currentAstId = 0;
    } else {
      // Return undefined
      this.add('ret', [ this.literal(undefined) ]);
    }
  }

  // Enumerate all present values in the order of appearance
  // (very useful for tests)
  this.enumerate();

  // Return JSON
  return [ this.toJSON() ].concat(this.children.map(function(child) {
    return child.toJSON();
  }));
};

CFG.prototype.toJSON = function toJSON() {
  var out = this.blocks.map(function(block) {
    return block.toJSON();
  });
  out[0].contextSize = this.contextSize;
  return out;
};

CFG.prototype.buildScope = function buildScope(node) {
  var isRoot = node === this.ast;
  var isFn = node.type === 'FunctionDeclaration' ||
             node.type === 'FunctionExpression';
  if (isFn) {
    if (node.id) {
      var name = node.id.name;
      var self;
      if (isRoot) {
        self = new Slot(name);
        self.type = 'self';
      } else if (node.type === 'FunctionDeclaration') {
        self = new Slot(name);
        self.initial = node;
        if (this.ast.type === 'Program')
          self.type = 'global';
      }
      this.scope[name] = self;
    }

    if (isRoot) {
      for (var i = 0; i < node.params.length; i++) {
        var arg = new Slot(node.params[i].name);
        arg.initial = this.add('loadArg', [ this.createValue('js', i) ]);
        this.scope[arg.name] = arg;
      }
    }
  } else if (node.type === 'VariableDeclaration') {
    for (var i = 0; i < node.declarations.length; i++) {
      var slot = new Slot(node.declarations[i].id.name);
      if (this.ast.type === 'Program')
        slot.type = 'global';
      this.scope[slot.name] = slot;
    }
  }

  // Visit direct children
  if ((!isFn || isRoot) && node.body) {
    if (Array.isArray(node.body)) {
      for (var i = 0; i < node.body.length; i++)
        this.buildScope(node.body[i]);
    } else {
      this.buildScope(node.body);
    }
  }

  if (node.consequent)
    this.buildScope(node.consequent);
  if (node.alternate)
    this.buildScope(node.alternate);

  if (node.type === 'ForStatement' && node.init)
    this.buildScope(node.init);
};

CFG.prototype.initializeLocals = function initializeLocals() {
  var assignments = [];

  Object.keys(this.scope).forEach(function(name) {
    var slot = this.scope[name];

    // Ignore self and non-local slots
    if (slot.type === 'self' || slot.type === 'context' && slot.depth !== 0)
      return;

    var value;
    if (slot.initial instanceof Value)
      value = slot.initial;
    else if (slot.initial)
      value = this.visit(slot.initial);
    else if (slot.type !== 'global')
      value = this.literal(undefined);
    else
      return;

    // Assign later, once we will settle down on the slot types
    assignments.push({ name: name, value: value });
  }, this);

  assignments.forEach(function(assignment) {
    this.set(assignment.name, assignment.value);
  }, this);
  this.initialized = true;
};

CFG.prototype.lookup = function lookup(name, context) {
  if (this.scope.hasOwnProperty(name)) {
    var res = this.scope[name];

    if (!context || res.type !== 'local')
      return res;

    // Local => context
    res.toContext(this);
    return res;
  } else {
    var res;

    // Lookup in parent
    if (this.parent) {
      res = new Slot(name, this.parent.lookup(name, true));
    // Global variable
    } else {
      res = new Slot(name);
      res.type = 'global';
    }
    this.scope[name] = res;
    return res;
  }
};

// Visitors

CFG.prototype.visit = function visit(node) {
  // Top-level node, visit direct children
  if (node === this.ast) {
    if (Array.isArray(node.body)) {
      for (var i = 0; i < node.body.length; i++)
        this.visit(node.body[i]);
    } else {
      this.visit(node.body);
    }
    return;
  }

  var oldAstId = this.root.currentAstId;
  var oldAst = this.root.currentAst;
  this.root.currentAstId = ++this.root.astId;
  this.root.currentAst = node;

  this.lastExpr = null;

  var res;
  if (node.type === 'ExpressionStatement')
    res = this.visitExpr(node);
  else if (node.type === 'VariableDeclaration')
    res = this.visitVar(node);
  else if (node.type === 'Literal')
    res = this.visitLiteral(node);
  else if (node.type === 'Identifier')
    res = this.visitIdentifier(node);
  else if (node.type === 'AssignmentExpression')
    res = this.visitAssign(node);
  else if (node.type === 'SequenceExpression')
    res = this.visitSeq(node);
  else if (node.type === 'BinaryExpression')
    res = this.visitBinary(node);
  else if (node.type === 'UnaryExpression')
    res = this.visitUnary(node);
  else if (node.type === 'MemberExpression')
    res = this.visitMember(node);
  else if (node.type === 'LogicalExpression')
    res = this.visitLogic(node);
  else if (node.type === 'UpdateExpression')
    res = this.visitUpdate(node);
  else if (node.type === 'NewExpression')
    res = this.visitCall('new', node);
  else if (node.type === 'CallExpression')
    res = this.visitCall('call', node);
  else if (node.type === 'ArrayExpression')
    res = this.visitArray(node);
  else if (node.type === 'ObjectExpression')
    res = this.visitObject(node);
  else if (node.type === 'ConditionalExpression')
    res = this.visitConditional(node);
  else if (node.type === 'ThisExpression')
    res = this.visitThis(node);
  else if (node.type === 'ReturnStatement')
    res = this.visitReturn(node);
  else if (node.type === 'IfStatement')
    res = this.visitIf(node);
  else if (node.type === 'WhileStatement')
    res = this.visitWhile(node);
  else if (node.type === 'DoWhileStatement')
    res = this.visitDoWhile(node);
  else if (node.type === 'ForStatement')
    res = this.visitFor(node);
  else if (node.type === 'BreakStatement')
    res = this.visitBreak(node);
  else if (node.type === 'ContinueStatement')
    res = this.visitContinue(node);
  else if (node.type === 'BlockStatement')
    res = this.visitBlock(node);
  else if (node.type === 'EmptyStatement' || node.type === 'DebuggerStatement')
    res = null;
  // Should be already processed in initialization of variables
  else if (node.type === 'FunctionDeclaration')
    res = this.visitFunction(node);
  else if (node.type === 'FunctionExpression')
    res = this.visitFunction(node);
  else
    throw new Error('Unknown node type: ' + node.type);

  this.root.currentAstId = oldAstId;
  this.root.currentAst = oldAst;

  return res;
};

CFG.prototype.visitExpr = function visitExpr(node) {
  var instr = this.visit(node.expression);
  this.lastExpr = instr;
  return instr;
};

CFG.prototype.visitVar = function visitVar(node) {
  for (var i = 0; i < node.declarations.length; i++) {
    var decl = node.declarations[i];
    if (!decl.init)
      continue;

    var value = this.visit(decl.init);
    this.set(decl.id.name, value);
  }
};

CFG.prototype.visitFunction = function visitFunction(node) {
  if (node === this.ast)
    return this.visit(node.body);

  if (node.type === 'FunctionDeclaration' && this.initialized)
    return null;

  var child = this.createChild(node);
  var cfg = child.construct();

  var fn = this.add('fn', [ this.createValue('js', cfg[0][0].id) ]);
  return fn;
};

CFG.prototype.visitLiteral = function visitLiteral(node) {
  return this.literal(node.value);
};

CFG.prototype.visitIdentifier = function visitIdentifier(node) {
  return this.get(node.name);
};

CFG.prototype.visitAssign = function visitAssign(node) {
  if (node.operator !== '=') {
    var lhs = this.visit(node.left);
    var rhs = this.visit(node.right);

    var binop = this.binary(node.operator.slice(0, -1), lhs, rhs);
    return this.assign(node.left, lhs, binop);
  }

  var rhs = this.visit(node.right);
  return this.assign(node.left, null, rhs);
};

CFG.prototype.visitSeq = function visitSeq(node) {
  var last;
  for (var i = 0; i < node.expressions.length; i++)
    last = this.visit(node.expressions[i]);
  return last;
};

CFG.prototype.visitBinary = function visitBinary(node) {
  var lhs = this.visit(node.left);
  var rhs = this.visit(node.right);

  return this.binary(node.operator, lhs, rhs);
};

CFG.prototype.visitUnary = function visitUnary(node) {
  if (node.operator !== 'delete') {
    var arg = this.visit(node.argument);

    return this.add('unary', [
      this.createValue('js', node.operator),
      arg
    ]);
  }

  // delete a.b
  var arg = node.argument;
  if (arg.type === 'MemberExpression') {
    var prop = arg.computed ?
        this.visit(arg.property) :
        this.literal(arg.property.name);
    var obj = this.visit(arg.object);

    return this.add('deleteProperty', [ obj, prop ]);
  // delete a
  } else if (arg.type === 'Identifier') {
    return this.add('deleteGlobal', [ this.createValue('js', arg.name) ]);

  // `delete true` and others
  // TODO(indutny): check standards
  } else {
    return this.literal(true);
  }
};

CFG.prototype.visitMember = function visitMember(node) {
  var prop = node.computed ?
      this.visit(node.property) :
      this.literal(node.property.name);
  var obj = this.visit(node.object);

  return this.add('loadProperty', [ obj, prop ]);
};

CFG.prototype.visitLogic = function visitLogic(node) {
  var lhs = this.visit(node.left);
  var cons = this.createBlock();
  var alt = this.createBlock();
  var join = this.createBlock();
  var phi = this.createValue('instruction', 'phi', []);

  this.add('branch', [ lhs ]);
  if (node.operator === '||') {
    this.block.end(cons, alt);

    this.block = cons;
    this.add('to_phi', [ phi, lhs ]);
    this.block.end(join);

    this.block = alt;
  } else {
    this.block.end(cons, alt);

    this.block = alt;
    this.add('to_phi', [ phi, lhs ]);
    this.block.end(join);

    this.block = cons;
  }

  var rhs = this.visit(node.right);
  this.add('to_phi', [ phi, rhs ]);
  this.block.end(join);

  this.block = join;
  this.block.push(phi);

  return phi;
};

CFG.prototype.visitUpdate = function visitUpdate(node) {
  // ++v
  if (node.prefix) {
    var arg = this.visit(node.argument);
    var binop = this.binary('+', arg, this.literal(1));
    return this.assign(node.argument, arg, binop);
  }

  var arg = this.visit(node.argument);
  var nop = this.add('nop', [ arg ]);
  var sum = this.add('binary', [
    this.createValue('js', '+'),
    nop,
    this.literal(1)
  ]);

  if (node.argument.type === 'Identifier') {
    // Just a variable
    this.set(node.argument.name, sum);
  } else {
    // obj[prop]++
    assert.equal(node.argument.type, 'MemberExpression');
    assert.equal(arg.type, 'instruction');
    assert.equal(arg.subtype, 'loadProperty');
    assert.equal(arg.inputs.length, 2);

    var obj = arg.inputs[0];
    var prop = arg.inputs[1];
    this.add('storeProperty', [ obj, prop, sum ]);
  }
  return nop;
};

CFG.prototype.visitCall = function visitCall(subtype, node) {
  var fn = this.visit(node.callee);
  var args = node.arguments.map(function(arg) {
    return this.visit(arg);
  }, this);

  for (var i = args.length - 1; i >= 0; i--)
    this.add('pushArg', [ args[i] ]);

  if (subtype === 'call') {
    var ctx;
    if (node.callee.type === 'MemberExpression')
      ctx = fn.inputs[0];
    else
      ctx = this.add('global', []);
    return this.add(subtype, [
      fn, ctx, this.createValue('js', args.length)
    ]);
  } else {
    return this.add(subtype, [ fn, this.createValue('js', args.length) ]);
  }
};

CFG.prototype.visitArray = function visitArray(node) {
  var arr = this.add('array', [ this.createValue('js', node.elements.length) ]);

  for (var i = 0; i < node.elements.length; i++) {
    var element = this.visit(node.elements[i]);
    this.add('storeProperty', [
      arr,
      this.literal(i),
      element
    ]);
  }

  return arr;
};

CFG.prototype.visitObject = function visitObject(node) {
  var obj = this.add('object', [
    this.createValue('js', node.properties.length)
  ]);

  for (var i = 0; i < node.properties.length; i++) {
    var prop = node.properties[i];
    var key = this.literal(prop.key.name || prop.key.value);
    var val = this.visit(prop.value);
    this.add('storeProperty', [ obj, key, val ]);
  }

  return obj;
};

CFG.prototype.visitConditional = function visitConditional(node) {
  var test = this.visit(node.test);
  var cons = this.createBlock();
  var alt = this.createBlock();
  var join = this.createBlock();
  var phi = this.createValue('instruction', 'phi', []);

  this.add('branch', [ test ]);
  this.block.end(cons, alt);

  this.block = cons;
  this.add('to_phi', [phi, this.visit(node.consequent) ]);
  this.block.end(join);

  this.block = alt;
  this.add('to_phi', [phi, this.visit(node.alternate) ]);
  this.block.end(join);

  this.block = join;
  this.block.push(phi);

  return phi;
};

CFG.prototype.visitThis = function visitThis(node) {
  return this.add('this', []);
};

CFG.prototype.visitReturn = function visitReturn(node) {
  if (node.argument)
    this.add('ret', [ this.visit(node.argument) ]);
  else
    this.add('ret', [ this.literal(undefined) ]);
  this.block.end();
  return null;
};

CFG.prototype.visitIf = function visitIf(node) {
  var test = this.visit(node.test);
  var cons = this.createBlock();
  var alt = this.createBlock();
  var join = this.createBlock();

  this.add('branch', [ test ]);
  this.block.end(cons, alt);

  // Consequent
  this.block = cons;
  this.visit(node.consequent);
  this.block.end(join);

  // Alternate
  this.block = alt;
  if (node.alternate)
    this.visit(node.alternate);
  this.block.end(join);

  this.block = join;
};

CFG.prototype.visitWhile = function visitWhile(node) {
  this.enterLoop(function() {
    this.add('branch', [ this.visit(node.test) ]);
  }, function() {
    this.visit(node.body);
  });
};

CFG.prototype.visitDoWhile = function visitDoWhile(node) {
  this.enterLoop(function() {
    this.add('branch', [ this.visit(node.test) ]);
  }, function() {
    this.visit(node.body);
  }, null, true);
};

CFG.prototype.visitFor = function visitFor(node) {
  if (node.init)
    this.visit(node.init);

  this.enterLoop(function() {
    this.add('branch', [
      node.test ? this.visit(node.test) : this.literal(true)
    ]);
  }, function() {
    this.visit(node.body);
  }, function() {
    if (node.update)
      this.visit(node.update);
  });
};

CFG.prototype.visitBreak = function visitBreak(node) {
  assert(this.loop, 'break without loop');
  this.block.end(this.loop.getBreak());
};

CFG.prototype.visitContinue = function visitContinue(node) {
  assert(this.loop, 'continue without loop');
  this.block.end(this.loop.getContinue());
};

CFG.prototype.visitBlock = function visitBlock(node) {
  for (var i = 0; i < node.body.length; i++)
    this.visit(node.body[i]);
  this.lastExpr = null;
};

// Helpers

CFG.prototype.createChild = function createChild(ast) {
  return new CFG(ast, this.options, this);
};

CFG.prototype.createBlock = function createBlock(ast) {
  var block = new Block(this.root, ast);
  this.blocks.push(block);
  return block;
};

CFG.prototype.enterLoop = function enterLoop(test, content, update, reverse) {
  var oldLoop = this.loop;
  this.loop = new LoopInfo(this);

  var contStart = this.loop.cont;

  var prestart = this.createBlock();
  var start = this.createBlock();

  this.block.end(prestart);
  if (!reverse)
    prestart.end(start);
  this.block = start;

  test.call(this);

  var body = this.createBlock();
  this.block.end(body, this.loop.brk);

  this.block = body;
  if (reverse)
    prestart.end(body);
  content.call(this);
  this.block.end(contStart);

  // Connect info to blocks
  this.block = this.loop.cont;
  if (update)
    update.call(this);
  this.block.end(prestart);

  this.block = this.loop.getBreak();
  this.loop = oldLoop;
};

CFG.prototype.createValue = function createValue(type, subtype, inputs) {
  return new Value(this.root, type, subtype, inputs);
};

CFG.prototype.add = function add(type, inputs) {
  var val = this.createValue('instruction', type, inputs);
  this.block.push(val);
  return val;
};

CFG.prototype.set = function set(name, value) {
  var slot = name instanceof Slot ? name : this.lookup(name);

  var res;
  if (slot.type === 'global') {
    this.add('storeGlobal', [
      this.createValue('js', name),
      value
    ]);
    res = value;
  } else if (slot.type === 'self') {
    res = null;
  } else {
    this.add('store', [ this.createValue('js', slot), value ]);
    res = value;
  }

  return res;
};

CFG.prototype.get = function get(name) {
  var slot = this.lookup(name);

  var res;
  if (slot.type === 'global') {
    res = this.add('loadGlobal', [ this.createValue('js', name) ]);
  } else if (slot.type === 'self') {
    res = this.add('self', []);
  } else {
    res = this.add('load', [ this.createValue('js', slot) ]);
  }

  return res;
};

CFG.prototype.literal = function literal(value) {
  return this.add('literal', [ this.createValue('js', value) ]);
};

CFG.prototype.binary = function binary(op, lhs, rhs) {
  return this.add('binary', [
    this.createValue('js', op),
    lhs,
    rhs
  ]);
};

CFG.prototype.assign = function assign(left, lhs, rhs) {
  // Just a variable
  if (left.type === 'Identifier')
    return this.set(left.name, rhs);

  // obj[prop] = rhs
  assert.equal(left.type, 'MemberExpression');
  var obj;
  var prop;
  if (lhs) {
    // Already computed
    assert.equal(lhs.type, 'instruction');
    assert.equal(lhs.subtype, 'loadProperty');
    assert.equal(lhs.inputs.length, 2);

    obj = lhs.inputs[0];
    prop = lhs.inputs[1];
  } else {
    prop = left.computed ?
        this.visit(left.property) :
        this.literal(left.property.name);
    obj = this.visit(left.object);
  }
  this.add('storeProperty', [ obj, prop, rhs ]);
  return rhs;
};

CFG.prototype.replaceVarAccess = function replaceVarAccess() {
  this.blocks.forEach(function(block) {
    var instructions = block.instructions;
    for (var i = instructions.length - 1; i >= 0; i--) {
      var instr = instructions[i];
      if (instr.subtype !== 'load' && instr.subtype !== 'store')
        continue;

      var slot = instr.inputs[0].subtype;
      assert(slot instanceof Slot);

      // Local stores are no-op, remove them
      if (slot.type === 'local') {
        if (instr.subtype === 'store')
          instr.inputs[1].markAssign(slot.name);

        // Replace uses with 'variable'
        instr.uses.forEach(function(use) {
          use.value.inputs[use.index] = this.createValue('variable', slot.name);
        }, this);

        instructions.splice(i, 1);
        continue;
      }

      // Replace context loads/stores with actual instruction
      var depth = this.createValue('js', slot.depth);
      var index = this.createValue('js', slot.index);
      instr.subtype = instr.subtype + 'Context';
      instr.inputs.splice(0, 1, depth, index);
    }
  }, this);
};

CFG.prototype.enumerate = function enumerate() {
  this.blocks.forEach(function(block) {
    block.instructions.forEach(function(instr) {
      if (instr.id === null)
        instr.id = 'i' + this.valueId++;

      instr.inputs.forEach(function(input) {
        if (input.id === null)
          input.id = 'i' + this.valueId++;
      }, this);
    }, this);
  }, this);
};

// Various classes

function Block(cfg, ast) {
  this.id = 'B' + cfg.blockId++;
  this.instructions = [];
  this.successors = [];
  this.ended = false;
  this.ast = ast || null;
}

Block.prototype.push = function push(instr) {
  if (!this.ended)
    this.instructions.push(instr);
};

Block.prototype.goto = function goto(block) {
  if (!this.ended)
    this.successors.push(block);
};

Block.prototype.end = function end(cons, alt) {
  if (cons)
    this.goto(cons);
  if (alt)
    this.goto(alt);
  this.ended = true;
};

Block.prototype.toJSON = function toJSON() {
  return {
    id: this.id,
    successors: this.successors.map(function(block) {
      return block.id;
    }),
    instructions: this.instructions.map(function(instr) {
      return instr.toJSON();
    })
  };
};

function Slot(name, parent) {
  this.name = name;

  if (parent) {
    this.type = parent.type;
    this.depth = this.type === 'context' ? parent.depth + 1 : parent.depth;
    this.index = parent.index;
  } else {
    this.type = 'local';
    this.depth = 0;
    this.index = 0;
  }

  // Only for function declarations
  this.initial = null;
}

Slot.prototype.toContext = function toContext(cfg) {
  this.type = 'context';
  this.index = cfg.contextSize++;
  this.depth = 0;
};

function Value(cfg, type, subtype, inputs) {
  this.type = type;
  // Will be set during cfg.enumerate()
  this.id = null;
  this.ast = cfg.root.currentAst;
  this.astId = cfg.root.currentAstId;
  this.subtype = subtype;
  this.uses = [];
  this.inputs = inputs ? inputs.map(function(value, i) {
    value.uses.push(new Use(this, i));
    return value;
  }, this) : null;
  this.assign = false;
  this.assignName = null;
}

Value.prototype.toInput = function toInput() {
  if (this.type === 'js') {
    return { type: 'js', value: this.subtype };
  } else if (this.type === 'instruction') {
    if (this.assign)
      return { type: 'variable', id: this.assignName };
    return { type: 'instruction', id: this.id };
  } else {
    return { type: 'variable', id: this.subtype };
  }
};

Value.prototype.toJSON = function toJSON() {
  assert.equal(this.type, 'instruction');
  return {
    id: this.assign ? this.assignName : this.id,
    ast: this.ast,
    astId: this.astId,
    type: this.subtype,
    inputs: this.inputs.map(function(input) {
      return input.toInput();
    }),
    assign: this.assign
  };
};

Value.prototype.markAssign = function markAssign(name) {
  this.assign = true;
  this.assignName = name;
};

function Use(value, index) {
  this.value = value;
  this.index = index;
}

function LoopInfo(cfg) {
  this.cfg = cfg;
  this.cont = cfg.createBlock();
  this.brk = cfg.createBlock();
}

LoopInfo.prototype.getContinue = function getContinue() {
  var c = this.cfg.createBlock();
  this.cont.end(c);
  this.cont = c;
  return c;
};

LoopInfo.prototype.getBreak = function getBreak() {
  var c = this.cfg.createBlock();
  this.brk.end(c);
  this.brk = c;
  return c;
};
