define([
  'angular',
  'lodash'
],
function (angular, _) {
  'use strict';

  var module = angular.module('grafana.controllers');

  var metricList = null;
  var currentDimension = null;

  module.controller('MonascaQueryCtrl', function($scope, uiSegmentSrv) {

    $scope.init = function() {
      if (!$scope.target.aggregator) {
        $scope.target.aggregator = 'avg';
      }
      if (!$scope.target.dimensions) {
        $scope.target.dimensions = [];
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

    function validateTarget() {
      $scope.target.errors = {};

      $scope.validateMetric();
      $scope.validateGroupBy();
      $scope.validateDimensions();
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
        });
      }
      $scope.validateDimensions();
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
            callback(dimensions.values[$scope.currentDimension.key]);
          });
        }
      }
      var values = $scope.dimensionList.values[$scope.currentDimension.key];
      values = values.concat($scope.datasource.listTemplates());
      values.push("$all");
      return values;
    };

    $scope.editDimension = function(index) {
      $scope.currentDimension = $scope.target.dimensions[index]
    }

    $scope.addDimension = function() {
      $scope.target.dimensions.push({})
      $scope.validateDimension($scope.target.dimensions.length -1)
    };

    $scope.removeDimension = function(index) {
      $scope.target.dimensions.splice(index, 1);
      $scope.targetBlur();
    };

    $scope.validateDimensions = function() {
      for (var i = 0; i < $scope.target.dimensions.length; i++) {
        $scope.validateDimension(i);
      }
      if (_.isEmpty($scope.target.errors.dimensions)) {
        delete $scope.target.errors.dimensions;
      }
    }

    $scope.validateDimension = function(index) {
      var dimension = $scope.target.dimensions[index]

      if (!("dimensions" in $scope.target.errors)) {
        $scope.target.errors.dimensions = {}
      }

      if (!('key' in dimension) || dimension.key === '') {
        $scope.target.errors.dimensions[index] = 'You must supply a dimension key.';
        return;
      }
      if (!('value' in dimension) || dimension.value === '') {
        $scope.target.errors.dimensions[index] = 'You must supply a dimension value.';
        return;
      }
      delete $scope.target.errors.dimensions;
    };

    $scope.getDimensionErrors = function(index) {
      if ("dimensions" in $scope.target.errors &&
          index in $scope.target.errors.dimensions){
        return $scope.target.errors.dimensions[index]
      }
      else {
        return null
      }
    }

    //////////////////////////////
    // ALIAS
    //////////////////////////////

    $scope.suggestAlias = function(query, callback) {
      var upToLastTag = query.substr(0, query.lastIndexOf('@'))
      var suggestions = $scope.datasource.listTemplates()
      var dimensions = $scope.suggestDimensionKeys(query, callback)
      for (var i = 0; i < dimensions.length; i++) {
        suggestions.push(upToLastTag+"@"+dimensions[i])
      }
      return suggestions;
    };

    $scope.init();

  });

});
