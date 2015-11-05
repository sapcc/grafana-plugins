define([
  'angular',
  'lodash'
],
function (angular, _) {
  'use strict';

  var module = angular.module('grafana.controllers');

  var metricList = null;

  module.controller('MonascaQueryCtrl', function($scope, uiSegmentSrv) {

    $scope.init = function() {
      if (!$scope.target.aggregator) {
        $scope.target.aggregator = 'avg';
      }
      if (!$scope.target.currentDimension) {
        $scope.target.currentDimension = {};
      }
      if ($scope.target.metric) {
        $scope.resetDimensionList();
      }
      validateTarget();
    };

    $scope.targetBlur = function() {
      validateTarget();
      if (!_.isEqual($scope.oldTarget, $scope.target) && _.isEmpty($scope.target.errors)) {
        $scope.oldTarget = angular.copy($scope.target);
        $scope.get_data();
      }
    };

    $scope.duplicate = function() {
      var clone = angular.copy($scope.target);
      $scope.panel.targets.push(clone);
    };

    function validateTarget() {
      $scope.target.errors = {};

      $scope.validateMetric();
      $scope.validateGroupBy();
      $scope.validateCurrentDimension();
    }

    //////////////////////////////
    // METRIC
    //////////////////////////////

    $scope.suggestMetrics = function(query, callback) {
      if (!$scope.metricList) {
        $scope.$apply(function() {
          $scope.datasource.namesQuery()
              .then($scope.datasource.convertNamesList)
              .then(function(metrics) {
            $scope.metricList = metrics;
            callback(metrics);
          });
        });
      }
      else {
        return $scope.metricList;
      }
    };

    $scope.validateMetricChange = function() {
      $scope.validateMetric();
      $scope.resetDimensionList();
    };

    $scope.validateMetric = function() {
      if (!$scope.target.metric) {
        $scope.target.errors.metric = 'You must supply a metric name.';
        return;
      }
      delete $scope.target.errors.metric;
    };

    //////////////////////////////
    // GROUP BY
    //////////////////////////////

    $scope.validateGroupBy = function() {
      if ($scope.target.aggregator != 'none') {
        if (!$scope.target.period) {
          $scope.target.errors.period = 'Group By Time must be set';
          return;
        }
      }
      delete $scope.target.errors.period;
    };

    function isInt(str) {
      var n = ~~Number(str);
      return String(n) === str && n >= 0;
    }

    //////////////////////////////
    // DIMENSIONS
    //////////////////////////////

    $scope.resetDimensionList = function() {
      $scope.dimensionList = { 'keys' : [], 'values' : {} };
      if (!$scope.target.errors.metric) {
        $scope.datasource.metricsQuery({'name' : $scope.target.metric})
            .then($scope.datasource.buildDimensionList)
            .then(function(dimensions) {
          $scope.dimensionList = dimensions;
          $scope.validateCurrentDimension();
        });
      }
      else {
        $scope.validateCurrentDimension();
      }
    };

    $scope.suggestDimensionKeys = function(query, callback) {
      if ($scope.dimensionList.keys.length === 0) {
        if (!$scope.target.errors.metric) {
          $scope.datasource.metricsQuery({'name' : $scope.target.metric})
              .then($scope.datasource.buildDimensionList)
              .then(function(dimensions) {
            $scope.dimensionList = dimensions;
            callback(dimensions.keys);
          });
        }
      }
      return $scope.dimensionList.keys;
    };

    $scope.suggestDimensionValues = function(query, callback) {
      if (_.isEmpty($scope.dimensionList.values)) {
        if (!$scope.target.errors.metric) {
          $scope.datasource.metricsQuery({'name' : $scope.target.metric})
              .then($scope.datasource.buildDimensionList)
              .then(function(dimensions) {
            $scope.dimensionList = dimensions;
            callback(dimensions.values[$scope.target.currentDimension.key]);
          });
        }
      }
      return $scope.dimensionList.values[$scope.target.currentDimension.key].concat($scope.datasource.listTemplates());
    };

    $scope.addDimension = function() {
      if (!$scope.addDimensionMode) {
        //Enabling this mode will display the dimension inputs
        $scope.target.currentDimension = {};
        $scope.addDimensionMode = true;
        $scope.validateCurrentDimension();
        return;
      }

      if (!$scope.target.dimensions) {
        $scope.target.dimensions = [];
      }

      $scope.validateCurrentDimension();
      if (!$scope.target.errors.dimension) {
        //Add new dimension to the list
        $scope.target.dimensions.push($scope.target.currentDimension);
        $scope.addDimensionMode = false;
      }

      $scope.targetBlur();
    };

    $scope.removeDimension = function(index) {
      $scope.target.dimensions.splice(index, 1);
      $scope.targetBlur();
    };

    $scope.clearDimension = function() {
      $scope.addDimensionMode = false;
      $scope.targetBlur();
    };

    $scope.validateCurrentDimension = function() {
      if ($scope.addDimensionMode === true) {
        if (!('key' in $scope.target.currentDimension) ||
            $scope.target.currentDimension.key === '') {
          $scope.target.errors.currentDimension = 'You must supply a dimension key.';
          return;
        }
        if (!('value' in $scope.target.currentDimension) ||
            $scope.target.currentDimension.value === '') {
          $scope.target.errors.currentDimension = 'You must supply a dimension value.';
          return;
        }
      }
      delete $scope.target.errors.currentDimension;
    };

    //////////////////////////////
    // ALIAS
    //////////////////////////////

    $scope.suggestAlias = function(query, callback) {
      return $scope.datasource.listTemplates();
    };

    $scope.init();

  });

});
