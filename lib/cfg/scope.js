'use strict';

const assert = require('assert');

function Scope(kind, parent) {
  this.kind = kind;
  this.parent = parent;
  this.space = new Set();
  this.depth = this.parent ? this.parent.depth + 1 : -1;
}
module.exports = Scope;

Scope.prototype.declare = function declare(kind, name) {
  if (kind === 'var' && this.kind !== 'program')
    return this.parent.declare(kind, name);

  this.space.add(name);
};

Scope.prototype.load = function load(pipeline, name) {
  // Global
  if (this.parent === null)
    return pipeline.add('loadGlobal').addLiteral(name);

  if (!this.space.has(name))
    return this.parent.load(pipeline, name);

  let ssa;
  if (this.depth === 0)
    ssa = name;
  else
    ssa = `${this.depth}/${name}`;
  return pipeline.add('ssa:load').addLiteral(ssa);
};

Scope.prototype.store = function store(pipeline, name, value) {
  // Global
  if (this.parent === null)
    return pipeline.add('storeGlobal', value).addLiteral(name);

  if (!this.space.has(name))
    return this.parent.store(pipeline, name, value);

  let ssa;
  if (this.depth === 0)
    ssa = name;
  else
    ssa = `${this.depth}/${name}`;
  return pipeline.add('ssa:store', value).addLiteral(ssa);
};

Scope.prototype.enter = function enter(kind) {
  return new Scope(kind, this);
};

Scope.prototype.leave = function leave() {
  return this.parent;
};
