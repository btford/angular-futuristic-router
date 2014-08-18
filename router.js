
var buildNavigationPlan = require('router/dist/cjs/navigationPlan').buildNavigationPlan;
var REPLACE = require('router/dist/cjs/navigationPlan').REPLACE;
var Pipeline = require('router/dist/cjs/pipeline').Pipeline;

angular.module('ngFuturisticRouter', []).

factory('createPipeline', ['$http', function ($http) {

  var BuildNavigationPlanStep = require('router/dist/cjs/navigationPlan').BuildNavigationPlanStep;
  var CommitChangesStep = require('router/dist/cjs/navigationContext').CommitChangesStep;

  function LoadNewComponentsStep (componentLoader) {
    this.componentLoader = {
      loadComponent: function (options) {
        var url = options.componentUrl;
        return new Promise(function (resolve, reject) {
          //$http.get(url).then(resolve, reject);

          // TODO: figure out what this API should look like
          resolve({
            executionContext: {}
          });
        });
      }
    };
  }

  LoadNewComponentsStep.prototype.run = function (navigationContext, next) {
    return loadNewComponents(this.componentLoader, navigationContext).
        then(next).catch(next.cancel);
  };

  return function createPipeline () {
    var pipeline = new Pipeline();
    pipeline.
        withStep(new BuildNavigationPlanStep).
        withStep(new LoadNewComponentsStep).
        withStep(new CommitChangesStep);
    return pipeline;
  };

}]).

factory('router', function (createPipeline) {
  var History = require('router/dist/cjs/history').History;
  var Router = require('router/dist/cjs/router').Router;

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
    createPipeline: createPipeline
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

  var elts = [];

  router.registerViewPort({
    process: function (command) {
      log(command);
      log(elts)
      elts.forEach(function (elt) {
        elt.html('look it did something');
      });
    },
    getComponent: function (opts) {
      //log(opts);
      return opts
    }
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
    link: function (scope, elt) {
      elts.push(elt);
      router.activate({ pushState: true });
    }
  };
});


function loadNewComponents(componentLoader, navigationContext) {
  var toLoad = determineWhatToLoad(navigationContext);
  var loadPromises = toLoad.map(function (current) {
    return loadComponent(componentLoader, current.navigationContext, current.viewPortPlan);
  });
  return Promise.all(loadPromises);
}

function determineWhatToLoad(navigationContext, toLoad) {
  var plan = navigationContext.plan;
  var next = navigationContext.nextInstruction;
  toLoad = toLoad || [];
  for (var viewPortName in plan) {
    var viewPortPlan = plan[viewPortName];
    if (viewPortPlan.strategy === REPLACE) {
      toLoad.push({
        viewPortPlan: viewPortPlan,
        navigationContext: navigationContext
      });
      if (viewPortPlan.childNavigationContext) {
        determineWhatToLoad(viewPortPlan.childNavigationContext, toLoad);
      }
    } else {
      var viewPortInstruction = next.addViewPortInstruction(viewPortName, viewPortPlan.strategy, viewPortPlan.prevComponentUrl, viewPortPlan.prevComponent);
      if (viewPortPlan.childNavigationContext) {
        viewPortInstruction.childNavigationContext = viewPortPlan.childNavigationContext;
        determineWhatToLoad(viewPortPlan.childNavigationContext, toLoad);
      }
    }
  }
  return toLoad;
}

// component-loading utils

function loadComponent(componentLoader, navigationContext, viewPortPlan) {
  var componentUrl = viewPortPlan.config.componentUrl;
  var next = navigationContext.nextInstruction;
  return resolveComponentView(componentLoader, navigationContext.router, viewPortPlan).then(function (component) {
    var viewPortInstruction = next.addViewPortInstruction(viewPortPlan.name, viewPortPlan.strategy, componentUrl, component);
    var controller = component.executionContext;
    if (controller.router) {
      var path = next.getWildcardPath();
      return controller.router.createNavigationInstruction(path, next).then(function (childInstruction) {
        viewPortPlan.childNavigationContext = controller.router.createNavigationContext(childInstruction);
        return buildNavigationPlan(viewPortPlan.childNavigationContext).then(function (childPlan) {
          viewPortPlan.childNavigationContext.plan = childPlan;
          viewPortInstruction.childNavigationContext = viewPortPlan.childNavigationContext;
          return loadNewComponents(componentLoader, viewPortPlan.childNavigationContext);
        });
      });
    }
  });
}

function resolveComponentView(componentLoader, router, viewPortPlan) {
  var possibleRouterViewPort = router.viewPorts[viewPortPlan.name];
  return componentLoader.loadComponent(viewPortPlan.config).then(function (directive) {
    return new Promise(function (resolve, reject) {
      function createChildRouter() {
        return router.createChild();
      }
      function getComponent(routerViewPort) {
        try {
          resolve(routerViewPort.getComponent(directive, createChildRouter));
        } catch (error) {
          reject(error);
        }
      }
      if (possibleRouterViewPort) {
        getComponent(possibleRouterViewPort);
      } else {
        router.viewPorts[viewPortPlan.name] = getComponent;
      }
    });
  });
}


// utils
// -----

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
