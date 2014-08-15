
angular.module('ngFuturisticRouter', []).

factory('router', function () {
  var History = require('router/dist/cjs/history').History;
  var Router = require('router/dist/cjs/router').Router;
  var Pipeline = require('router/dist/cjs/pipeline').Pipeline;
  var BuildNavigationPlanStep = require('router/dist/cjs/navigationPlan').BuildNavigationPlanStep;
  var CommitChangesStep = require('router/dist/cjs/navigationContext').CommitChangesStep;

  // TODO: use $location instead of History
  var history = new History();
  var router = new Router(history);

  router.activate = function (options) {
    if (this.isActive) {
      return;
    }

    this.isActive = true;
    this.options = extend({ routeHandler: this.loadUrl.bind(this) }, this.options, options);
    this.history.activate(this.options);
    this.dequeueInstruction();
  };

  router.loadUrl = function (url) {
    return this.createNavigationInstruction(url).
      then(this.queueInstruction.bind(this)).
      catch(function (error) {
        console.error(error);

        if (this.history.previousFragment) {
          this.navigate(this.history.previousFragment, false);
        }
      }.bind(this));
  };

  router.pipelineProvider = {
    createPipeline: function () {
      var pipeline = new Pipeline();
      pipeline.
          withStep(new BuildNavigationPlanStep).
          withStep(new CommitChangesStep);
      return pipeline;
    }
  };

  router.queue = [];

  router.deactivate = function () {
    this.isActive = false;
    this.history.deactivate();
  };

  router.queueInstruction = function (instruction) {
    return new Promise(function (resolve) {
      instruction.resolve = resolve;
      this.queue.unshift(instruction);
      this.dequeueInstruction();
    }.bind(this));
  };

  router.dequeueInstruction = function () {
    if (this.isNavigating) {
      return;
    }

    var instruction = this.queue.shift();
    this.queue = [];

    if (!instruction) {
      return;
    }

    this.isNavigating = true;

    var context = this.createNavigationContext(instruction);
    var pipeline = this.pipelineProvider.createPipeline(context);

    pipeline.run(context).then(function (result) {
      this.isNavigating = false;

      if (result.completed) {
        this.history.previousFragment = instruction.fragment;
      }

      if (result.output instanceof Error) {
        console.error(result.output);
      }

      if (isNavigationCommand(result.output)) {
        result.output.navigate(this);
      } else if (!result.completed && this.history.previousFragment) {
        this.navigate(this.history.previousFragment, false);
      }

      instruction.resolve(result);
      this.dequeueInstruction();
    }.bind(this));
  }

  document.addEventListener('click', handleLinkClick.bind(router), true);

  return router;
}).

directive('routerViewPort', function ($location, router) {

  var log = console.log.bind(console);

  router.registerViewPort({
    process: log,
    getComponent: log
  });

  router.configure(function (config) {
    config.title = 'Router Demo';

    config.map([
      { pattern: ['','foo'],   componentUrl: 'foo',   nav: true, title: 'Home' },
      { pattern: 'bar',        componentUrl: 'bar',   nav: true }
    ]);
  });

  return {
    restrict: 'AE',
    link: function () {
      router.activate({ pushState: true });
    }
  };
});

function handleLinkClick(ev) {
  if (!this.isActive) {
    return;
  }

  var target = ev.target;
  if (target.tagName != 'A') {
    return;
  }

  if (this.history._hasPushState) {
    if (!ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey && targetIsThisWindow(target)) {
      var href = target.getAttribute('href');

      // Ensure the protocol is not part of URL, meaning its relative.
      // Stop the event bubbling to ensure the link will not cause a page refresh.
      if (href != null && !(href.charAt(0) === "#" || (/^[a-z]+:/i).test(href))) {
        ev.preventDefault();
        this.history.navigate(href);
      }
    }
  }
}

function targetIsThisWindow(target) {
  var targetWindow = target.getAttribute('target');

  return !targetWindow ||
    targetWindow === window.name ||
    targetWindow === '_self' ||
    (targetWindow === 'top' && window === window.top);
}

function extend(obj) {
  var rest = Array.prototype.slice.call(arguments, 1);

  for (var i = 0, length = rest.length; i < length; i++) {
    var source = rest[i];

    if (source) {
      for (var prop in source) {
        obj[prop] = source[prop];
      }
    }
  }

  return obj;
}

function isNavigationCommand(obj){
  return obj && typeof obj.navigate === 'function';
}
