# Contributing to Virtual Substation

Thank you for your interest in contributing to the Virtual Substation project!

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/yourusername/virtual-substation.git`
3. Create a feature branch: `git checkout -b feature-name`
4. Make your changes
5. Test thoroughly
6. Submit a pull request

## Development Setup

```bash
./install.sh
./check_status.sh  # Verify installation
```

## Testing

- Test on Ubuntu/Debian systems
- Verify both GUI and command-line modes
- Test protection logic with various fault conditions
- Ensure proper cleanup with `./stop_all.sh`

## Code Style

- Follow existing code patterns
- Comment complex protection logic
- Use meaningful variable names
- Keep functions focused and small

## Reporting Issues

Please include:
- Operating system and version
- Network interface details
- Steps to reproduce
- Expected vs actual behavior
- Error messages or logs

## Areas for Contribution

- Additional protection functions (67, 32, etc.)
- Enhanced GUI features
- Performance optimizations
- Documentation improvements
- Platform support (Windows, macOS)
- Unit tests
- Docker containerization

## Questions?

Open an issue for discussion before major changes.