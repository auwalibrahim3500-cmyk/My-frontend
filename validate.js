const ApiError = require('../utils/ApiError');

/**
 * validate({ body, query, params }) — each value is a Joi schema.
 * On failure, throws a 400 ApiError with field-level details.
 */
function validate(schemas) {
  return (req, res, next) => {
    for (const key of ['body', 'query', 'params']) {
      const schema = schemas[key];
      if (!schema) continue;
      const { error, value } = schema.validate(req[key], { abortEarly: false, stripUnknown: true });
      if (error) {
        throw ApiError.badRequest(
          'Validation failed.',
          error.details.map((d) => ({ field: d.path.join('.'), message: d.message }))
        );
      }
      req[key] = value;
    }
    next();
  };
}

module.exports = validate;
