define([
  'angular',
  'lodash',
  'app/core/utils/datemath',
  'kbn',
  './directives',
  './query_ctrl',
  'moment',
],
function (angular, _, dateMath, kbn) {
  'use strict';

  var module = angular.module('grafana.services');

  module.factory('MonascaDatasource', function($q, backendSrv, templateSrv) {

    function MonascaDatasource(datasource) {
      this.url = datasource.url;
      this.name = datasource.name;

      this.token = datasource.jsonData.token;
    }

    MonascaDatasource.prototype.query = function(options) {
      var dataSource = this;
      var from =  this.translateTime(options.range.from);
      var to =  this.translateTime(options.range.to);

      var targets = [];
      for (var i = 0; i < options.targets.length; i++) {
        var target = options.targets[i];
        if (!_.isEmpty(target.errors) || target.hide) {
          continue;
        }
        var query = this.buildDataQuery(options.targets[i], from, to);
        query = templateSrv.replace(query, options.scopedVars);
        var query_list = this.expandQueries(query);
        targets = targets.concat(query_list);
      }

      var promises = targets.map(function (target) {
        target = dataSource.convertPeriod(target);
        return dataSource._monascaRequest(target, {}).then(dataSource.convertDataPoints);
      });

      return $q.all(promises).then(function(results) {
        return { data: _.flatten(results).filter(function(result) { return !_.isEmpty(result)}) };
      });
    };

    MonascaDatasource.prototype.namesQuery = function() {
      return this._monascaRequest('/v2.0/metrics/names', {});
    };

    MonascaDatasource.prototype.convertNamesList = function(data) {
      var metrics = [];
      data = data.data.elements;
      for (var i = 0; i < data.length; i++) {
        metrics.push(data[i].name);
      }
      return metrics;
    };

    MonascaDatasource.prototype.metricsQuery = function(params) {
      return this._monascaRequest('/v2.0/metrics', params);
    };

    MonascaDatasource.prototype.buildDimensionList = function(data) {
      var keys = [];
      var values = {};
      data = data.data.elements;
      for (var i = 0; i < data.length; i++) {
        var dim_set = data[i].dimensions;
        Object.keys(dim_set).forEach(function (key) {
            if (keys.indexOf(key) == -1) {
              keys.push(key);
              values[key] = [];
            }
            var value = dim_set[key];
            if (values[key].indexOf(value) == -1) {
              values[key].push(value);
            }
        });
      }
      return {'keys' : keys, 'values' : values};
    };

    MonascaDatasource.prototype.buildDataQuery = function(options, from, to) {
      var params = {};
      params.name = options.metric;
      params.merge_metrics = 'true';
      params.start_time = from;
      if (to) {
        params.end_time = to;
      }
      if (options.dimensions) {
        var dimensions = '';
        for (var i = 0; i < options.dimensions.length; i++) {
          var key = options.dimensions[i].key;
          var value = options.dimensions[i].value;
          if (dimensions) {
            dimensions += ',';
          }
          dimensions += key;
          dimensions += ':';
          dimensions += value;
        }
        params.dimensions = dimensions;
      }
      if (options.alias) {
        params.alias = options.alias;
      }
      var path;
      if ( options.aggregator != 'none' ) {
        params.statistics = options.aggregator;
        params.period = options.period;
        path = '/v2.0/metrics/statistics';
      }
      else {
        path = '/v2.0/metrics/measurements';
      }
      var first = true;
      Object.keys(params).forEach(function (key) {
        if (first) {
          path += '?';
          first = false;
        }
        else {
          path += '&';
        }
        path += key;
        path += '=';
        path += params[key];
      });
      return path;
    };

    MonascaDatasource.prototype.expandQueries = function(query) {
      var templated_vars = query.match(/{[^}]*}/g);
      if ( !templated_vars ) {
        return [query];
      }

      var expandedQueries = [];
      var to_replace = templated_vars[0];
      var var_options = to_replace.substring(1, to_replace.length - 1);
      var_options = var_options.split(',');
      for (var i = 0; i < var_options.length; i++) {
        var new_query = query.replace(new RegExp(to_replace, 'g'), var_options[i]);
        expandedQueries = expandedQueries.concat(this.expandQueries(new_query));
      }
      return expandedQueries;
    };

    MonascaDatasource.prototype.convertDataPoints = function(data) {
      var url = data.config.url;
      data = data.data.elements[0];
      if (!data) {
        return {};
      }

      var target = data.name;
      var alias = url.match(/alias=[^&]*/);
      if ( alias ) {
        target = alias[0].substring('alias='.length);
      }
      var raw_datapoints;
      var aggregator;
      if ('measurements' in data) {
        raw_datapoints = data.measurements;
        aggregator = 'value';
      }
      else {
        raw_datapoints = data.statistics;
        aggregator = url.match(/statistics=[^&]*/);
        aggregator = aggregator[0].substring('statistics='.length);
      }
      var datapoints = [];
      var timeCol = data.columns.indexOf('timestamp');
      var dataCol = data.columns.indexOf(aggregator);
      for (var i = 0; i < raw_datapoints.length; i++) {
        var datapoint = raw_datapoints[i];
        var time = new Date(datapoint[timeCol]);
        var point = datapoint[dataCol];
        datapoints.push([point, time.getTime()]);
      }

      var convertedData = { 'target': target, 'datapoints': datapoints };
      return convertedData;
    };

    MonascaDatasource.prototype._monascaRequest = function(path, params) {
      var data = null;
      var headers = {
        'Content-Type': 'application/json',
        'X-Auth-Token': this.token
      };

      var options = {
        method: 'GET',
        url:    this.url + path,
        params: params,
        headers: headers,
        withCredentials: true,
      };

      return backendSrv.datasourceRequest(options);
    };

    MonascaDatasource.prototype.metricFindQuery = function(query) {
      return this.metricsQuery({}).then(function(data) {
        var values = [];
        data = data.data.elements;
        for (var i = 0; i < data.length; i++) {
          var dim_set = data[i].dimensions;
          if ( query in dim_set ) {
            var value = dim_set[query];
            if (values.indexOf(value) == -1) {
              values.push(value);
            }
          }
        }
        return _.map(values, function(value) {
          return {text: value};
        });
      });
    };

    MonascaDatasource.prototype.listTemplates = function() {
      var template_list = [];
      for (var i = 0; i < templateSrv.variables.length; i++) {
        template_list.push('$'+templateSrv.variables[i].name);
      }
      return template_list;
    };

    MonascaDatasource.prototype.testDatasource = function() {
      return this.namesQuery().then(function () {
        return { status: 'success', message: 'Data source is working', title: 'Success' };
      });
    };

    MonascaDatasource.prototype.translateTime = function(date) {
      if (date === 'now') {
        return null;
      }
      return moment.utc(dateMath.parse(date).valueOf()).toISOString();
    };

    MonascaDatasource.prototype.convertPeriod = function(target) {
      var regex = target.match(/period=[^&]*/);
      if (regex) {
        var period = regex[0].substring('period='.length);
        var matches = period.match(kbn.interval_regex);
        if (matches) {
          period = kbn.interval_to_seconds(period);
          target = target.replace(regex, 'period='+period);
        }
      }
      return target;
    };

    MonascaDatasource.prototype.isInt = function(str) {
      var n = ~~Number(str);
      return String(n) === str && n >= 0;
    };

    return MonascaDatasource;

  });

});