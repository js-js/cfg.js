'use strict';

const assert = require('assert');

function Scope(kind, parent) {
  this.kind = kind;
  this.parent = parent;
  this.space = new Set();
}
module.exports = Scope;

Scope.prototype.declare = function declare(kind, name) {
  assert.equal(kind, 'var', 'let,const is not supported yet');

  this.space.add(name);
};

Scope.prototype.load = function load(pipeline, name) {
  // Global
  if (this.parent === null)
    return pipeline.add('loadGlobal').addLiteral(name);

  if (!this.space.has(name))
    return this.parent.load(pipeline, name);

  return pipeline.add('ssa:load').addLiteral(name);
};

Scope.prototype.store = function store(pipeline, name, value) {
  // Global
  if (this.parent === null)
    return pipeline.add('storeGlobal', value).addLiteral(name);

  if (!this.space.has(name))
    return this.parent.store(pipeline, name, value);

  return pipeline.add('ssa:store', value).addLiteral(name);
};

Scope.prototype.enter = function enter(kind) {
  return new Scope(kind, this);
};

Scope.prototype.leave = function leave() {
  return this.parent;
};
