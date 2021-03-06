/*!
 * locker.js - lock and queue for bcoin
 * Copyright (c) 2014-2015, Fedor Indutny (MIT License)
 * Copyright (c) 2014-2016, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

var EventEmitter = require('events').EventEmitter;
var utils = require('../utils/utils');
var assert = require('assert');

/**
 * Represents a mutex lock for locking asynchronous object methods.
 * @exports Locker
 * @constructor
 * @param {Function?} add - `add` method (whichever method is queuing data).
 */

function Locker(add) {
  if (!(this instanceof Locker))
    return Locker.create(add);

  EventEmitter.call(this);

  this.add = add === true;

  this.jobs = [];
  this.busy = false;

  this.pending = [];
  this.pendingMap = {};

  this.unlocker = this.unlock.bind(this);
}

utils.inherits(Locker, EventEmitter);

/**
 * Create a closure scoped locker.
 * @param {Function?} add
 * @returns {Function} Lock method.
 */

Locker.create = function create(add) {
  var locker = new Locker(add);
  return function lock(arg1, arg2) {
    return locker.lock(arg1, arg2);
  };
};

/**
 * Test whether the locker has a pending
 * object by key (usually a {@link Hash}).
 * @param {Hash|String} key
 * @returns {Boolean}
 */

Locker.prototype.hasPending = function hasPending(key) {
  return this.pendingMap[key] === true;
};

/**
 * Lock the parent object and all its methods
 * which use the locker. Begin to queue calls.
 * @param {Boolean?} force - Bypass the lock.
 * @returns {Promise->Function} Unlocker - must be
 * called once the method finishes executing in order
 * to resolve the queue.
 */

Locker.prototype.lock = function lock(arg1, arg2) {
  var self = this;
  var force, object;

  if (this.add) {
    object = arg1;
    force = arg2;
  } else {
    force = arg1;
  }

  if (force) {
    assert(this.busy);
    return Promise.resolve(utils.nop);
  }

  if (this.busy) {
    if (object) {
      this.pending.push(object);
      this.pendingMap[object.hash('hex')] = true;
    }
    return new Promise(function(resolve, reject) {
      self.jobs.push([resolve, object]);
    });
  }

  this.busy = true;

  return Promise.resolve(this.unlocker);
};

/**
 * The actual unlock callback.
 * @private
 */

Locker.prototype.unlock = function unlock() {
  var item, resolve, object;

  this.busy = false;

  if (this.pending.length === 0)
    this.emit('drain');

  if (this.jobs.length === 0)
    return;

  item = this.jobs.shift();
  resolve = item[0];
  object = item[1];

  if (object) {
    assert(object === this.pending.shift());
    delete this.pendingMap[object.hash('hex')];
  }

  this.busy = true;

  resolve(this.unlocker);
};

/**
 * Destroy the locker. Purge all pending calls.
 */

Locker.prototype.destroy = function destroy() {
  this.jobs.length = 0;
  this.busy = false;
  this.pending.length = 0;
  this.pendingMap = {};
};

/**
 * Wait for a drain (empty queue).
 * @returns {Promise}
 */

Locker.prototype.onDrain = function onDrain() {
  var self = this;

  assert(this.add, 'Cannot wait for drain without add method.');

  return new Promise(function(resolve, reject) {
    if (self.pending.length === 0)
      return resolve();

    self.once('drain', resolve);
  });
};

/**
 * Represents a mutex lock for locking asynchronous object methods.
 * Locks methods according to passed-in key.
 * @exports MappedLock
 * @constructor
 */

function MappedLock() {
  if (!(this instanceof MappedLock))
    return MappedLock.create();

  this.jobs = {};
  this.busy = {};
}

/**
 * Create a closure scoped locker.
 * @returns {Function} Lock method.
 */

MappedLock.create = function create() {
  var locker = new MappedLock();
  return function lock(key, force) {
    return locker.lock(key, force);
  };
};

/**
 * Lock the parent object and all its methods
 * which use the locker with a specified key.
 * Begin to queue calls.
 * @param {String|Number} key
 * @param {Function} func - The method being called.
 * @param {Array} args - Arguments passed to the method.
 * @param {Boolean?} force - Force a call.
 * @returns {Function} Unlocker - must be
 * called once the method finishes executing in order
 * to resolve the queue.
 */

MappedLock.prototype.lock = function lock(key, force) {
  var self = this;

  if (force || key == null) {
    assert(key == null || this.busy[key]);
    return Promise.resolve(utils.nop);
  }

  if (this.busy[key]) {
    return new Promise(function(resolve, reject) {
      if (!self.jobs[key])
        self.jobs[key] = [];
      self.jobs[key].push(resolve);
    });
  }

  this.busy[key] = true;

  return Promise.resolve(this.unlock(key));
};

/**
 * Create an unlock callback.
 * @private
 * @param {String} key
 * @returns {Function} Unlocker.
 */

MappedLock.prototype.unlock = function unlock(key) {
  var self = this;
  return function unlocker() {
    var jobs = self.jobs[key];
    var resolve;

    delete self.busy[key];

    if (!jobs)
      return;

    resolve = jobs.shift();
    assert(resolve);

    if (jobs.length === 0)
      delete self.jobs[key];

    self.busy[key] = true;

    resolve(unlocker);
  };
};

/**
 * Destroy the locker. Purge all pending calls.
 */

MappedLock.prototype.destroy = function destroy() {
  this.jobs = {};
  this.busy = {};
};

/*
 * Expose
 */

exports = Locker;
exports.Mapped = MappedLock;

module.exports = exports;
