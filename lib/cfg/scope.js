'use strict';

function Scope(parent) {
  this.parent = parent;
  this.map = new Map();
}
module.exports = Scope;

Scope.prototype.load = function load(pipeline, name) {
  // Global
  if (this.parent === null)
    return pipeline.add('loadGlobal').addLiteral(name);

  if (!this.map.has(name))
    return this.parent.load(pipeline, name);

  throw new Error('Local load not implemented');
};

Scope.prototype.store = function store(pipeline, name, value) {
  // Global
  if (this.parent === null)
    return pipeline.add('storeGlobal', value).addLiteral(name);

  if (!this.map.has(name))
    return this.parent.store(pipeline, name, value);

  throw new Error('Local store not implemented');
};

Scope.prototype.enter = function enter() {
  return new Scope(this);
};

Scope.prototype.leave = function leave() {
  return this.parent;
};
