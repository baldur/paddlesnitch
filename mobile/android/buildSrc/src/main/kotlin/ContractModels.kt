import groovy.json.JsonSlurper
import java.io.File

/**
 * Kotlin models from the shared API contract (the `.schema.json` files in mobile/contract/api,
 * written by `pnpm mobile:contract` from the server's types). Covers the subset
 * of JSON Schema the contract uses and follows its rules
 * (mobile/contract/README.md):
 *
 * - unknown fields are ignored (the app's Json has ignoreUnknownKeys);
 * - a string enum gets an `Unknown` entry (`Unrecognised` when the contract
 *   itself has an "unknown" value), and a `oneOf` on `kind` an
 *   `Unknown` case, so a value from a newer server never fails decoding;
 * - integers are Long, numbers Double; optional or nullable fields default to
 *   null.
 *
 * Inline objects and enums are nested in the class that uses them, named after
 * the field (an array's item in the singular: `Logbook.weeks` → `Week`).
 * Models are for decoding; `oneOf` cases don't write their `kind` back.
 */
object ContractModels {
    /** A string as Kotlin source (constants carry words shown to people, so `"`, `\` and `$` must survive). */
    private fun lit(v: Any?): String = if (v is String) "\"" + v.replace("\\", "\\\\").replace("\"", "\\\"").replace("$", "\\$") + "\"" else v.toString()

    /** One api/constants.json entry: a `const val`, or a `Map` for a table of words (e.g. stravaConnectResults). */
    private fun constant(k: String, v: Any?): String = when (v) {
        is Map<*, *> -> "    val $k: Map<String, String> = mapOf(" + v.entries.joinToString(", ") { (a, b) -> "${lit(a)} to ${lit(b)}" } + ")"
        else -> "    const val $k = ${lit(v)}"
    }

    fun generate(apiDir: File, packageName: String): String {
        @Suppress("UNCHECKED_CAST")
        val schemas = apiDir.listFiles { f -> f.name.endsWith(".schema.json") }!!
            .sortedBy { it.name }
            .associate { it.name.removeSuffix(".schema.json") to JsonSlurper().parse(it) as Map<String, Any?> }
        val body = schemas.entries.joinToString("\n\n") { (name, schema) -> Gen(name).topLevel(schema) }
        // api/constants.json: values the app must send exactly as the server expects.
        @Suppress("UNCHECKED_CAST")
        val constants = apiDir.resolve("constants.json").takeIf { it.exists() }
            ?.let { JsonSlurper().parse(it) as Map<String, Any?> }.orEmpty()
            .entries.joinToString("\n") { (k, v) -> constant(k, v) }
        return """
            |// Generated from mobile/contract/api by buildSrc/ContractModels.kt. Do not edit.
            |@file:Suppress("unused")
            |
            |package $packageName
            |
            |import kotlinx.serialization.KSerializer
            |import kotlinx.serialization.Serializable
            |import kotlinx.serialization.descriptors.PrimitiveKind
            |import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
            |import kotlinx.serialization.encoding.Decoder
            |import kotlinx.serialization.encoding.Encoder
            |import kotlinx.serialization.json.JsonContentPolymorphicSerializer
            |import kotlinx.serialization.json.JsonElement
            |import kotlinx.serialization.json.JsonObject
            |import kotlinx.serialization.json.JsonPrimitive
            |import kotlinx.serialization.json.contentOrNull
            |import kotlinx.serialization.json.jsonObject
            |import kotlinx.serialization.json.jsonPrimitive
            |
            |""".trimMargin() + body + "\n\n/** From api/constants.json. */\nobject Constants {\n$constants\n}\n"
    }

    private fun pascal(s: String) = s.split('_', '-', ' ').filter { it.isNotEmpty() }
        .joinToString("") { it.replaceFirstChar(Char::uppercase) }

    private fun singular(s: String) = if (s.endsWith("s") && s.length > 1) s.dropLast(1) else s

    /** An enum value as a Kotlin name: "gps_lost" → GpsLost, "4X+" → _4XPlus. */
    private fun enumName(v: String): String {
        val n = pascal(v.replace("+", "Plus").replace("-", "Minus"))
        return if (n.first().isDigit()) "_$n" else n
    }

    private fun indent(s: String, by: String = "    ") = s.lines().joinToString("\n") { if (it.isBlank()) it else by + it }

    @Suppress("UNCHECKED_CAST")
    private class Gen(val root: String) {
        fun topLevel(schema: Map<String, Any?>): String = when {
            schema["oneOf"] != null -> sealed(root, schema["oneOf"] as List<Map<String, Any?>>)
            schema["enum"] != null -> enum(root, schema["enum"] as List<String>)
            schema["properties"] != null -> dataClass(root, schema)
            else -> "typealias $root = ${type(schema, root, mutableListOf()).first}"
        }

        /** The Kotlin type for a schema, and whether it may be null. Nested declarations go to [nested]. */
        fun type(s: Map<String, Any?>, name: String, nested: MutableList<String>): Pair<String, Boolean> {
            s["\$ref"]?.let { return (it as String).removeSuffix(".schema.json") to false }
            (s["allOf"] as List<Map<String, Any?>>?)?.let { return type(it.single(), name, nested) }
            (s["anyOf"] as List<Map<String, Any?>>?)?.let { options ->
                val notNull = options.filter { it["type"] != "null" }
                if (notNull.size == 1) return type(notNull.single(), name, nested).first to (notNull.size < options.size)
                return "JsonPrimitive" to (notNull.size < options.size)
            }
            (s["oneOf"] as List<Map<String, Any?>>?)?.let { nested += sealed(name, it); return name to false }
            val t = s["type"]
            if (t is List<*>) {
                val notNull = t.filter { it != "null" }
                return type(s + ("type" to notNull.single()), name, nested).first to (notNull.size < t.size)
            }
            return when (t) {
                "string" -> (s["enum"] as List<String>?)?.let { nested += enum(name, it); name to false } ?: ("String" to false)
                "integer" -> "Long" to false
                "number" -> "Double" to false
                "boolean" -> "Boolean" to false
                "array" -> when (val items = s["items"]) {
                    is List<*> -> "List<Double>" to false   // a tuple: [lat, lng]
                    is Map<*, *> -> "List<${type(items as Map<String, Any?>, singular(name), nested).first}>" to false
                    else -> "List<JsonElement>" to false
                }
                "object" -> if (s["properties"] != null) { nested += dataClass(name, s); name to false } else ("JsonObject" to false)
                else -> "JsonElement" to false
            }
        }

        fun dataClass(name: String, s: Map<String, Any?>, parent: String? = null, skip: Set<String> = emptySet()): String {
            val props = (s["properties"] as Map<String, Map<String, Any?>>).filterKeys { it !in skip }
            val required = (s["required"] as List<String>?).orEmpty().toSet()
            val nested = mutableListOf<String>()
            val fields = props.map { (field, schema) ->
                val (t, nullable) = type(schema, pascal(field), nested)
                if (field in required && !nullable) "val $field: $t" else "val $field: $t? = null"
            }
            val header = "@Serializable\ndata class $name(\n${fields.joinToString(",\n") { "    $it" }},\n)" +
                (parent?.let { " : $it" } ?: "")
            return if (nested.isEmpty()) header else "$header {\n${nested.joinToString("\n\n") { indent(it) }}\n}"
        }

        fun enum(name: String, values: List<String>): String {
            // The catch-all for values from a newer server; named apart when the contract has its own "unknown".
            val other = if (values.any { enumName(it) == "Unknown" }) "Unrecognised" else "Unknown"
            val entries = values.joinToString(",\n") { "    ${enumName(it)}(\"$it\")" } + ",\n    $other(\"\");"
            return """
                |@Serializable(with = $name.Serializer::class)
                |enum class $name(val wire: String) {
                |$entries
                |
                |    internal object Serializer : KSerializer<$name> {
                |        override val descriptor = PrimitiveSerialDescriptor("$root.$name", PrimitiveKind.STRING)
                |        override fun deserialize(decoder: Decoder): $name =
                |            decoder.decodeString().let { s -> entries.firstOrNull { it != $other && it.wire == s } ?: $other }
                |        override fun serialize(encoder: Encoder, value: $name) = encoder.encodeString(value.wire)
                |    }
                |}""".trimMargin()
        }

        /** A `oneOf` told apart by its `kind` const, plus an Unknown case for kinds this app doesn't know. */
        fun sealed(name: String, variants: List<Map<String, Any?>>): String {
            val cases = variants.map { v ->
                val kind = ((v["properties"] as Map<String, Map<String, Any?>>)["kind"]
                    ?: error("$root.$name: every oneOf case needs a kind"))["const"] as String
                kind to pascal(kind)
            }
            val classes = variants.zip(cases).joinToString("\n\n") { (v, c) -> dataClass(c.second, v, name, skip = setOf("kind")) }
                .replace("data class (\\w+)\\(\n\\)".toRegex(), "data object $1")
            val select = cases.joinToString("\n") { (kind, cls) -> "            \"$kind\" -> $cls.serializer()" }
            return """
                |@Serializable(with = $name.Serializer::class)
                |sealed interface $name {
                |${indent(classes)}
                |
                |    /** A kind this app doesn't know yet (a newer server). */
                |    @Serializable
                |    data class Unknown(val kind: String? = null) : $name
                |
                |    object Serializer : JsonContentPolymorphicSerializer<$name>($name::class) {
                |        override fun selectDeserializer(element: JsonElement) = when (element.jsonObject["kind"]?.jsonPrimitive?.contentOrNull) {
                |$select
                |            else -> Unknown.serializer()
                |        }
                |    }
                |}""".trimMargin()
        }
    }
}
