'use strict';

function Slot(kind) {
  this.kind = kind;
  this.object = null;
  this.property = null;
  this.name = null;
}
module.exports = Slot;

Slot.createVar = function createVar(name) {
  const res = new Slot('var');
  res.name = name;
  return res;
};

Slot.createProperty = function createProperty(object, property) {
  const res = new Slot('property');
  res.object = object;
  res.property = property;
  return res;
};

Slot.createNamedProperty = function createNamedProperty(object, name) {
  const res = new Slot('named');
  res.object = object;
  res.name = name;
  return res;
};
