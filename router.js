

var log = console.log.bind(console);

angular.module('ngFuturisticRouter', []).

factory('createPipeline', function ($http, componentLoader, $q) {

  var Pipeline = require('router/dist/cjs/pipeline').Pipeline;

  var navPlan = require('router/dist/cjs/navigationPlan');

  var REPLACE                 = navPlan.REPLACE,
      buildNavigationPlan     = navPlan.buildNavigationPlan,
      BuildNavigationPlanStep = navPlan.BuildNavigationPlanStep;

  var CommitChangesStep = require('router/dist/cjs/navigationContext').CommitChangesStep;

  function LoadNewComponentsStep () {
    this.componentLoader = componentLoader;
  }

  LoadNewComponentsStep.prototype.run = function (navigationContext, next) {
    return loadNewComponents(this.componentLoader, navigationContext).
        then(next).catch(next.cancel);
  };

  function loadNewComponents(componentLoader, navigationContext) {
    var toLoad = determineWhatToLoad(navigationContext);
    var loadPromises = toLoad.map(function (current) {
      return loadComponent(componentLoader, current.navigationContext, current.viewPortPlan);
    });
    return $q.all(loadPromises);
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
      return $q(function (resolve, reject) {
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

  return function createPipeline () {
    var pipeline = new Pipeline();
    pipeline.
        withStep(new BuildNavigationPlanStep()).
        withStep(new LoadNewComponentsStep()).
        withStep(new CommitChangesStep());
    return pipeline;
  };

}).

factory('componentLoader', function ($http, $controller) {
  return {
    loadComponent: function (options) {
      var url = this.getFullUrl(options.componentUrl);
      return $http.get(url).then(function (data) {
        // TODO: figure out what this API should look like;
        // should this also be responsible for instantiating the ctrl
        return componentInstance = {
          template: data.data,
          controller: 'MyController',
          executionContext: {}
        };
      });
    },
    getFullUrl: function (componentUrl) {
      return componentUrl + '/component.html';
    }
  }
}).

factory('history', function ($location) {
  return {
    navigate: function (path) {
      $location.url(path);
      return this.options.routeHandler ?
          this.options.routeHandler(path) :
          false;
    },
    options: {}
  }
}).

/*
 * top-level router
 */
factory('router', function (createPipeline, $location, history, $rootScope, $q) {
  var Router = require('router/dist/cjs/router').Router;

  // TODO: use $location instead of History
  var router = new Router(history);


  router.activate = function (options) {
    if (this.isActive) {
      return;
    }

    this.isActive = true;
    this.options = extend({
      routeHandler: this.loadUrl.bind(this)
    }, this.options, options);
    history.options.routeHandler = this.options.routeHandler;

    this.dequeueInstruction();
    document.addEventListener('click', handleLinkClick, true);
  };

  // TODO: not sure about this
  router.config = function () {
    Router.prototype.config.apply(this, arguments);
    this.refreshNavigation();
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
    //this.history.deactivate();
    document.removeEventListener('click', handleLinkClick, true);
  };

  router.queueInstruction = function (instruction) {
    return $q(function (resolve) {
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

  function handleLinkClick(ev) {
    if (!router.isActive) {
      return;
    }

    var target = ev.target;
    if (target.tagName !== 'A') {
      return;
    }

    if (!ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey && targetIsThisWindow(target)) {
      var href = target.getAttribute('href');

      // Ensure the protocol is not part of URL, meaning its relative.
      // Stop the event bubbling to ensure the link will not cause a page refresh.
      if (href != null && !(href.charAt(0) === "#" || (/^[a-z]+:/i).test(href))) {
        ev.preventDefault();
        $rootScope.$apply(function () {
          router.history.navigate(href);
        });
      }
    }
  }

  return router;
}).

/*
 * this solves the "child router" problem
 */
factory('routerMapping', function ($rootScope, router) {
  var routers = {};
  routers[$rootScope.$id] = router;

  return {
    get: function (scope) {
      while (scope && !routers[scope.$id]) {
        scope = scope.$parent;
      }
      return routers[scope.$id];
    },
    add: function (scope, router) {
      routers[scope.$id] = router;

      // TODO: test this
      scope.$on('$destroy', function () {
        routers[scope.$id].deactivate();
        delete routers[scope.$id];
      });
    }
  }
}).

directive('routerViewPort', function ($location, routerMapping, $compile, $controller) {
  return {
    restrict: 'AE',
    link: function (scope, elt, attrs) {
      var router = routerMapping.get(scope);

      router.registerViewPort({
        process: function (command) {
          if (command.component.template) {
            var childScope = scope.$new();
            var template = command.component.template;
            elt.html(template);

            var link = $compile(elt.contents());

            var childRouter = router.createChild();
            routerMapping.add(childScope, childRouter);

            console.log(childRouter);

            $controller(command.component.controller, {
              $scope: childScope,
              router: childRouter
            });

            link(childScope);
            // TODO: controllerAs
          } else {
            elt.html('look it did something: ' + JSON.stringify({
              name     : command.name,
              strategy : command.strategy //,
              //lifecycle: command.lifecycleArgs
            }));
          }
        },
        getComponent: function (opts, getChildRouter) {
          //log(opts);
          return opts;
        }
      }, attrs.routerViewPort);

      router.activate();
    }
  };
});


// utils
// -----

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
