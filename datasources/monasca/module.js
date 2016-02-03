define([
  './datasource',
],
function (MonascaDatasource) {
  'use strict';

  function metricsQueryEditor() {
    return {controller: 'MonascaQueryCtrl', templateUrl: 'app/plugins/datasource/monasca/partials/query.editor.html'};
  }

  function metricsQueryOptions() {
    return {templateUrl: 'app/plugins/datasource/monasca/partials/query.options.html'};
  }

  function configView() {
    return {templateUrl: 'app/plugins/datasource/monasca/partials/config.html'};
  }

  return {
    Datasource: MonascaDatasource,
    configView: configView,
    metricsQueryEditor: metricsQueryEditor,
    metricsQueryOptions: metricsQueryOptions,
  };

});
