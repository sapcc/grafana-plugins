define([
  'angular',
  'lodash',
  'app/core/utils/datemath',
  'app/core/utils/kbn',
  './query_ctrl',
  'moment',
],
function (angular, _, dateMath, kbn) {
  'use strict';

  function MonascaDatasource(instanceSettings, $q, backendSrv, templateSrv) {
    this.url = instanceSettings.url;
    this.name = instanceSettings.name;
    this.access= instanceSettings.access;
    if (instanceSettings.jsonData) {
      this.token = instanceSettings.jsonData.token;
      this.keystoneAuth = instanceSettings.jsonData.keystoneAuth;
    } else {
      this.token = null;
      this.keystoneAuth = null;
    }

    this.query = function(options) {
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
        var query_list = this.expandQueries(query);
        targets_list.push(query_list);
      }
      var targets_promise = $q.all(targets_list).then(function(results) {
        return _.flatten(results)
      });

      var promises = $q.resolve(targets_promise).then(function(targets) {
        return targets.map(function (target) {
          target = datasource.convertPeriod(target);
          return datasource._monascaRequest(target, {}).then(datasource.convertDataPoints);
        });
      });

      return $q.resolve(promises).then(function(promises) {
        return $q.all(promises).then(function(results) {
          return { data: _.flatten(results).filter(function(result) { return !_.isEmpty(result)}) };
        });
      });
    };

    this.namesQuery = function() {
      return this._monascaRequest('/v2.0/metrics/names', {});
    };

    this.convertNamesList = function(data) {
      var metrics = [];
      data = data.data.elements;
      for (var i = 0; i < data.length; i++) {
        metrics.push(data[i].name);
      }
      return metrics;
    };

    this.metricsQuery = function(params) {
      return this._monascaRequest('/v2.0/metrics', params);
    };

    this.buildDimensionList = function(data) {
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

    this.buildMetricList = function(data) {
      data = data.data.elements;
      return data
    };

    this.buildDataQuery = function(options, from, to) {
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

    this.expandQueries = function(query) {
      var datasource = this;
      return this.expandAllQueries(query).then(function(partial_query_list) {
        var query_list = []
        for (var i = 0; i < partial_query_list.length; i++) {
          query_list = query_list.concat(datasource.expandTemplatedQueries(partial_query_list[i]));
        }
        query_list = datasource.autoAlias(query_list)
        return query_list
      })
    };

    this.expandTemplatedQueries = function(query) {
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
        expandedQueries = expandedQueries.concat(this.expandTemplatedQueries(new_query));
      }
      return expandedQueries;
    };

    this.expandAllQueries = function(query) {
      if (query.indexOf("$all") > -1) {
        var metric_name = query.match(/name=([^&]*)/)[1]
        var start_time = query.match(/start_time=([^&]*)/)[1]

        // Find all matching subqueries
        var dimregex = /(?:dimensions=|,)([^,]*):\$all/g;
        var matches, neededDimensions = [];
        while (matches = dimregex.exec(query)) {
            neededDimensions.push(matches[1]);
        }

        var metricQueryParams = {'name' : metric_name, 'start_time': start_time}
        var queriesPromise = this.metricsQuery(metricQueryParams).then(function(data) {
          var expandedQueries = []
          var metrics = data.data.elements
          var matchingMetrics = {} // object ensures uniqueness of dimension sets
          for (var i = 0; i < metrics.length; i++) {
            var dimensions = metrics[i].dimensions
            var set = {}
            var skip = false
            for (var j = 0; j < neededDimensions.length; j++) {
              var key = neededDimensions[j]
              if (!(key in dimensions)) {
                skip = true
                break
              };
              set[key] = dimensions[key]
            }
            if (!skip) {
              matchingMetrics[JSON.stringify(set)] = set
            };
          }
          Object.keys(matchingMetrics).forEach(function (set) {
            var new_query = query
            var match = matchingMetrics[set]
            Object.keys(match).forEach(function (key) {
              var to_replace = key+":\\$all"
              var replacement = key+":"+match[key]
              new_query = new_query.replace(new RegExp(to_replace, 'g'), replacement);
            })
            expandedQueries.push(new_query);
          })
          return expandedQueries
        });

        return queriesPromise;
      }
      else {
        return $q.resolve([query]);
      };
    };

    this.autoAlias = function(query_list) {
      for (var i = 0; i < query_list.length; i++) {
        var query = query_list[i]
        var alias = query.match(/alias=@([^&]*)/)
        var dimensions = query.match(/dimensions=([^&]*)/)
        if (alias && dimensions) {
          var key = alias[1]
          var regex =  new RegExp(key+":([^,^&]*)")
          var value = dimensions[1].match(regex)
          if (value) {
            query_list[i] = query.replace("@"+key, value[1]);
          }
        }
      }
      return query_list
    };

    this.convertDataPoints = function(data) {
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

    this._monascaRequest = function(path, params) {
      var headers = {
        'Content-Type': 'application/json',
      };

      if (this.token) {
        headers['X-Auth-Token'] = this.token
      }

      var options = {
        method: 'GET',
        url:    this.url + path,
        params: params,
        headers: headers,
        withCredentials: true,
      };

      if (this.keystoneAuth) {
        options['keystoneAuth'] = true;
      }

      return backendSrv.datasourceRequest(options);
    };

    this.metricFindQuery = function(query) {
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

    this.listTemplates = function() {
      var template_list = [];
      for (var i = 0; i < templateSrv.variables.length; i++) {
        template_list.push('$'+templateSrv.variables[i].name);
      }
      return template_list;
    };

    this.testDatasource = function() {
      return this.namesQuery().then(function () {
        return { status: 'success', message: 'Data source is working', title: 'Success' };
      });
    };

    this.translateTime = function(date) {
      if (date === 'now') {
        return null;
      }
      return moment.utc(dateMath.parse(date).valueOf()).toISOString();
    };

    this.convertPeriod = function(target) {
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

    this.isInt = function(str) {
      var n = ~~Number(str);
      return String(n) === str && n >= 0;
    };
  }

  return MonascaDatasource;
});
