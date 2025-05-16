export const lexicons = [
  {
    "lexicon": 1,
    "id": "blue.snippet.code",
    "revision": 1,
    "description": "A single code snippet",
    "defs": {
      "main": {
        "type": "record",
        "key": "didSelf",
        "record": {
          "type": "object",
          "required": [
            "name",
            "lang",
            "code",
            "createdAt"
          ],
          "properties": {
            "name": {
              "type": "string",
              "maxLength": 200
            },
            "desc": {
              "type": "string",
              "maxLength": 1000
            },
            "lang": {
              "type": "string"
            },
            "code": {
              "type": "string",
              "maxLength": 65536
            },
            "createdAt": {
              "type": "string",
              "format": "datetime"
            }
          }
        }
      }
    }
  }
]
