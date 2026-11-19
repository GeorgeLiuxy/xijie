import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

// Generates the first-boot SQL locally; no password is printed or sent over HTTP.
public class BootstrapPassword {
    public static void main(String[] args) throws Exception {
        if (args.length != 2) throw new IllegalArgumentException("Use two private file paths");
        String password = Files.readString(Path.of(args[0]), StandardCharsets.UTF_8).trim();
        if (!password.matches("[a-f0-9]{64}")) throw new IllegalArgumentException("Expected a fresh random password");
        String hash = new BCryptPasswordEncoder(12).encode(password);
        Files.writeString(Path.of(args[1]), "USE jeepaydb;\nUPDATE t_sys_user_auth SET credential='" + hash + "' WHERE identifier='jeepay' AND sys_type='MGR';\nCREATE TABLE IF NOT EXISTS xijie_local_bootstrap (id TINYINT PRIMARY KEY, version INT NOT NULL);\nINSERT INTO xijie_local_bootstrap VALUES(1,1) ON DUPLICATE KEY UPDATE version=1;\n", StandardCharsets.UTF_8);
    }
}
