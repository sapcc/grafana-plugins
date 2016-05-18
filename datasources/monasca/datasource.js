define([
  'angular',
  'lodash',
  'app/core/utils/datemath',
  'app/core/utils/kbn',
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

      if (datasource.jsonData) {
        this.token = datasource.jsonData.token;
        this.keystoneAuth = datasource.jsonData.keystoneAuth;
      } else {
        this.token = null;
        this.keystoneAuth = null;
      }
    }

    MonascaDatasource.prototype.query = function(options) {
      var datasource = this;
      var from =  this.translateTime(options.range.from);
      var to =  this.translateTime(options.range.to);

      var targets_list = [];
      for (var i = 0; i < options.targets.length; i++) {
        var target = options.targets[i];
        if (!_.isEmpty(target.errors) || target.hide) {
          continue;
        }
        var query = this.buildDataQuery(options.targets[i], from, to);
        query = templateSrv.replace(query, options.scopedVars);
        targets_list.push(query);
      }

      var promises = targets_list.map(function (target) {
          target = datasource.convertPeriod(target);
          return datasource._limitedMonascaRequest(target, {}).then(datasource.convertDataPoints);
      });

      return $q.resolve(promises).then(function(promises) {
        return $q.all(promises).then(function(results) {
          results = _.flatten(results)
          return { data: _.flatten(results).filter(function(result) { return !_.isEmpty(result)}) };
        });
      });
    };

    MonascaDatasource.prototype.namesQuery = function() {
      return this._limitedMonascaRequest('/v2.0/metrics/names', {});
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
      return this._limitedMonascaRequest('/v2.0/metrics', params);
    };

    MonascaDatasource.prototype.buildDimensionList = function(data) {
      var keys = [];
      var values = {};
      data = data.data.elements;
      for (var i = 0; i < data.length; i++) {
        var dim_set = data[i].dimensions;
        for (var key in dim_set) {
          if (keys.indexOf(key) == -1) {
            keys.push(key);
            values[key] = [];
          }
          var value = dim_set[key];
          if (values[key].indexOf(value) == -1) {
            values[key].push(value);
          }
        }
      }
      return {'keys' : keys, 'values' : values};
    };

    MonascaDatasource.prototype.buildMetricList = function(data) {
      data = data.data.elements;
      return data;
    };

    MonascaDatasource.prototype.buildDataQuery = function(options, from, to) {
      var params = {};
      params.name = options.metric;
      params.merge_metrics = 'true';
      params.group_by = '*';
      params.start_time = from;
      if (to) {
        params.end_time = to;
      }
      if (options.dimensions) {
        var dimensions = '';
        for (var i = 0; i < options.dimensions.length; i++) {
          var key = options.dimensions[i].key;
          var value = options.dimensions[i].value;
          if (value == '$all') {
            continue;
          }
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
      if (options.aggregator != 'none') {
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

    MonascaDatasource.prototype.convertDataPoints = function(data) {
      var url = data.config.url;
      var results = []

      for (var i = 0; i < data.data.elements.length; i++)
      {
        var element = data.data.elements[i];

        var target = element.name;
        var alias = data.config.url.match(/alias=([^&]*)/);
        if (alias) {
          alias = alias[1]
          if (alias.substring(0, 1) == "@") {
            alias = element.dimensions[alias.substring(1)]
            target = alias
          }
          target = alias
        }

        var raw_datapoints;
        var aggregator;
        if ('measurements' in element) {
          raw_datapoints = element.measurements;
          aggregator = 'value';
        }
        else {
          raw_datapoints = element.statistics;
          aggregator = url.match(/statistics=[^&]*/);
          aggregator = aggregator[0].substring('statistics='.length);
        }
        var datapoints = [];
        var timeCol = element.columns.indexOf('timestamp');
        var dataCol = element.columns.indexOf(aggregator);
        for (var j = 0; j < raw_datapoints.length; j++) {
          var datapoint = raw_datapoints[j];
          var time = new Date(datapoint[timeCol]);
          var point = datapoint[dataCol];
          datapoints.push([point, time.getTime()]);
        }
        var convertedData = { 'target': target, 'datapoints': datapoints };
        results.push(convertedData)
      }
      return results;
    };

    // For use with specified or api enforced limits.
    // Pages through data until all data is retrieved.
    MonascaDatasource.prototype._limitedMonascaRequest = function(path, params) {
      var datasource = this;
      var deferred = $q.defer();
      var data = null;
      var element_list = [];

      function aggregateResults() {
        var elements = {};
        for (var i = 0; i < element_list.length; i++) {
          var element = element_list[i];
          if (element.id in elements){
            if (element.measurements){
              elements[element.id].measurements = elements[element.id].measurements.concat(element.measurements);
            }
            if (element.statistics){
              elements[element.id].measurements = elements[element.id].statistics.concat(element.statistics);
            }
          }
          else{
            elements[element.id] = element;
          }
        }
        data.data.elements = Object.keys(elements).map(function(key){
          return elements[key];
        });
      }

      function requestAll(multi_page) {
        datasource._monascaRequest(path, params)
          .then(function(d) {
            data = d;
            element_list = element_list.concat(d.data.elements);
            if(d.data.links) {
              for (var i = 0; i < d.data.links.length; i++) {
                if (d.data.links[i].rel == 'next'){
                  var next = decodeURIComponent(d.data.links[i].href)
                  var offset = next.match(/offset=([^&]*)/);
                  params.offset = offset[1];
                  requestAll(true);
                  return;
                }
              }
            }
            if (multi_page){
              aggregateResults();
            }
            deferred.resolve(data);
          });
      }
      requestAll(false);
      return deferred.promise;
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
          if (query in dim_set) {
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
