const Templates = require('./templates')
const Winnow = require('winnow')
const Utils = require('./utils')
const _ = require('lodash')

module.exports = query

/**
 * processes params based on query params
 *
 * @param {object} data
 * @param {object} params
 * @param {function} callback
 */
function query (data, params = {}) {
  // TODO clean up this series of if statements
  if (data.filtersApplied && data.filtersApplied.geometry) delete params.geometry
  if ((data.filtersApplied && data.filtersApplied.where) || params.where === '1=1') delete params.where
  if (data.statistics) return statisticsResponse(data.statistics)
  if (params.returnCountOnly && data.count) return { count: data.count }
  // TODO this should happen within winnow
  const metadata = data.metadata || {}
  const oidField = metadata.idField || 'OBJECTID'
  // add objectIds as long as this is not a stats request
  if (!params.outStatistics && data.features[0] && data.features[0].properties[oidField] === undefined) {
    data.features.forEach((f, i) => {
      f.properties.OBJECTID = i
    })
  }

  if (params.f !== 'geojson') params.toEsri = true
  const queriedData = Winnow.query(data, params)

  if (params.f === 'geojson') return { type: 'FeatureCollection', features: queriedData.features }
  else return geoservicesPostQuery(data, queriedData, params)
}

function geoservicesPostQuery (data, queriedData, params) {
  // options.objectIds works alongside returnCountOnly but not statistics
  const oidField = (data.metadata && data.metadata.idField) || 'OBJECTID'
  if (params.objectIds && !params.outStatistics) {
    let oids = typeof params.objectIds === 'string' ? params.objectIds.split(',') : params.objectIds
    oids = oids.map(i => {
      return parseInt(i, 10)
    })
    queriedData.features = queriedData.features.filter(f => {
      return oids.indexOf(f.attributes[oidField]) > -1
    })
  }

  if (params.returnCountOnly) {
    return { count: queriedData.features.length }
  } else if (params.returnIdsOnly) {
    return idsOnly(queriedData, data.metadata)
  } else if (params.outStatistics) {
    return queryStatistics(queriedData, params)
  } else {
    params.extent = Utils.getExtent(queriedData)
    params.geometryType = Utils.getGeomType(data)
    // TODO should these be calculated using the whole dataset?
    params.spatialReference = params.outSR
    params.attributeSample = data.features[0] && data.features[0].properties
    return Templates.render('features', queriedData, params)
  }
}

function queryStatistics (data, params) {
  // This little dance is in place because the stat response from Winnow is different
  // TODO make winnow come out as expected
  // or move this into templates.render
  const statResponse = {
    type: 'FeatureCollection',
    features: []
  }
  const features = Array.isArray(data) ? data : [data]
  statResponse.features = features.map(row => {
    return { attributes: row }
  })
  return Templates.render('statistics', statResponse, params)
}

function statisticsResponse (stats) {
  if (!Array.isArray(stats)) stats = [stats]
  return {
    displayFieldName: '',
    fieldAliases: createFieldAliases(stats),
    fields: createStatFields(stats),
    features: createStatFeatures(stats)
  }
}

function createFieldAliases (stats) {
  const fields = Object.keys(stats[0])
  return fields.reduce((aliases, field) => {
    aliases[field] = field
    return aliases
  }, {})
}

function createStatFeatures (stats) {
  return stats.map(attributes => {
    return { attributes }
  })
}

function createStatFields (stats) {
  return Object.keys(stats[0]).map(field => {
    const sample = _.find(stats, s => {
      return stats[field] !== null
    })
    const statField = {
      name: field,
      type: detectType(sample[field]),
      alias: field
    }
    if (statField.type === 'esriFieldTypeString') statField.length = 254
    return statField
  }, {})
}

function detectType (value) {
  if (!value) return null
  else if (typeof value === 'string') return 'esriFieldTypeString'
  else if (typeof value === 'number') return 'esriFieldTypeDouble'
}

function idsOnly (data, options = {}) {
  const oidField = options.idField || 'OBJECTID'
  return data.features.reduce(
    (resp, f) => {
      resp.objectIds.push(f.attributes[oidField])
      return resp
    },
    { objectIdField: oidField, objectIds: [] }
  )
}
